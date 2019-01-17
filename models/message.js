const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    sender: {
        type: String,
        required: true,
    },
    text: {
        type: String,
        required: true,
    },
    chat: {
        type: String,
        required: true,
    },
    date: {
        type: Date,
        required: true,
    }
});

const Message = mongoose.model('Message', MessageSchema);
module.exports = Message;
