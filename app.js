// Imports.
const express = require("express");
const moment = require("moment");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const helpers = require('express-helpers');
const session = require("express-session");
const router = express.Router();
const User = require('./models/user');
const Message = require('./models/message');
const Room = require('./models/room');


// App setup.
const app = express();
app.set('views', './src/views');
app.set('view engine', 'ejs');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
helpers(app);
//use sessions for tracking logins
app.use(session({
    secret: 'work hard',
    resave: true,
    saveUninitialized: false,
}));

// Start socket.io
const http = require("http").Server(app);
const io = require("socket.io")(http);

// Secret
const conString = "";

mongoose.connect(conString, null, (err) => {
    console.log("Database connection", err);
});

const interval = {};
// GET route for reading data.
router.get('/', function (req, res, next) {
    if (req.session && req.session.user) {
        clearInterval(interval[req.session.user._id]);
        const userString = req.session.user.username
        interval[req.session.user._id] = setInterval(() => {
            io.emit("heartbeat-" + userString, null);
        }, 300);
    }
    Room.find({}, (error, rooms) => {
        rooms = rooms.filter(room => room.name.startsWith("groupchat-"));
        User.find({}, (error, users) =>
            res.render('index', {user: req.session.user, rooms: rooms, users: users})
        );
    });
});

// GET route for sign up.
router.get('/sign-up', function (req, res, next) {
    res.render('sign-up', {user: null});
});

// GET route for group chat.
router.get('/groupchat', function (req, res, next) {
    if (!req.session || !req.session.user) {
        res.redirect('sign-up');
    }
    Room.findOne({name: 'groupchat-' + req.query.name}, (error, room) => {
        if (room) {
            Message.find({chat: req.query.name}, (error, messages) => {
                res.render('chat', {user: req.session.user, messages: messages, name: req.query.name, moment: moment});
            });
        } else {
            const err = new Error('Chat room does not exist.');
            err.status = 412;
            return next(err);
        }
    });
});

// GET route for private chat.
router.get('/privatechat', function (req, res, next) {
    if (!req.session || !req.session.user) {
        res.redirect('sign-up');
    }

    User.findOne({username: req.query.name}, (error, user) => {
        if (user) {
            const chatName = 'privatechat-' + (req.session.user._id < user._id ?
                req.session.user._id + '-' + user._id  + "-": user._id + "-" + req.session.user._id + "-");
            Room.findOne({name: chatName}, (error, room) => {
                if (room) {
                    Message.find({chat: chatName}, (error, messages) => {
                        io.emit("privatechat-" + req.session.user._id, {username: req.query.name, messages: messages});
                    });
                } else {
                    try {
                        const room = new Room({
                            name: chatName,
                            owner: req.session.user && req.session.user.username,
                        });
                        room.save();
                        io.emit("privatechat-" + req.session.user._id, {username: req.query.name, messages: []})
                    } catch (error) {
                        res.sendStatus(500);
                        console.error(error);
                    }
                }
            });
        } else {
            const err = new Error('User does not exist.');
            err.status = 413;
            return next(err);
        }
    });
});

router.post('/login', function (req, res, next) {
    const {logemail, logpassword} = req.body;
    if (logemail && logpassword) {
        User.authenticate(logemail, logpassword, function (error, user) {
            if (error || !user) {
                const err = new Error('Wrong email or password.');
                err.status = 401;
                return next(err);
            } else {
                req.session.user = user;
                return res.redirect('/');
            }
        })
    }
});

//POST route for registering user.
router.post('/register', function (req, res, next) {
    const {email, username, password, passwordConf} = req.body;
    if (email && username && password && passwordConf) {
        // Confirm that user typed same password twice
        if (password !== passwordConf) {
            const err = new Error('Passwords do not match.');
            err.status = 400;
            res.send(`passwords don't match`);
            return next(err);
        }

        const userData = {email, username, password, passwordConf};

        User.create(userData, function (error, user) {
            if (error) {
                return next(error);
            } else {
                req.session.user = user;
                return res.redirect('/');
            }
        });

    } else {
        const err = new Error('All fields required.');
        err.status = 400;
        return next(err);
    }
});

// GET for logout.
router.get('/logout', function (req, res, next) {
    if (req.session) {
        const userId = req.session.user._id;
        // delete session object
        req.session.destroy(function (err) {
            if (err) {
                return next(err);
            } else {
                clearInterval(interval[userId]);
                return res.redirect('/');
            }
        });
    }
});


// POST for creating room.
router.post("/create-room", (req, res) => {
    try {
        const room = new Room({
            name: 'groupchat-' + req.body.name,
            owner: req.session.user && req.session.user.username,
        });
        room.save();
        // room.sendStatus(200);
        res.redirect('/');
    } catch (error) {
        res.sendStatus(500);
        console.error(error);
    }
});

router.post("/send-message", (req, res) => {
    try {
        const {text, chat, isPrivate, receiverName} = req.body;
        if (!chat && isPrivate) {
            User.findOne({username: receiverName}, (error, user) => {
                if (user) {
                    const chatName = 'privatechat-' + (req.session.user._id < user._id ?
                        req.session.user._id + '-' + user._id + "-" : user._id + "-" + req.session.user._id + "-");
                    const message = new Message({
                        sender: req.session.user.username,
                        text,
                        chat: chatName,
                        date: Date.now(),
                    });
                    message.save();
                    io.emit("privatechat-" + user._id, {username: req.session.user.username, message: message});
                    io.emit("privatechat-" + req.session.user._id, {username: receiverName, message: message});
                } else {
                    const err = new Error('User does not exist.');
                    err.status = 413;
                    return next(err);
                }
            });
        } else {
            const message = new Message({
                sender: req.session.user.username,
                text,
                chat,
                date: Date.now(),
            });
            message.save();
            io.emit("groupchat-" + chat, message);
        }
    } catch (error) {
        res.sendStatus(500);
        console.error(error);
    }
});

app.use('/', router);

const server = http.listen(3020, () => {
    console.log("Well done, now I am listening on ", server.address().port);
});

io.on("connection", (socket) => {
    console.log("Socket is connected...");
    setInterval(() => {
        for (const user of groupchatHeartbeat) {
            io.emit("heartbeat-gc-" + user.chatname, user.username);
        }
        groupchatHeartbeat.clear();
    }, 500);

    socket.on("heartbeat-groupchat", (user) => {
        groupchatHeartbeat.add(user);
    });
});

const groupchatHeartbeat = new Set();
