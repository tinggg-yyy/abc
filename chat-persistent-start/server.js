const express = require("express");

const https = require("https");
// to read certificates from the filesystem (fs)
const fs = require("fs");

const app = express(); // the server "app", the server behaviour
const portHTTPS = 4200; // port for https

// returning to the client anything that is
// inside the public folder
app.use(express.static("public"));

// Creating object of key and certificate
// for SSL
const options = {
  key: fs.readFileSync("keys-for-local-https/localhost-key.pem"),
  cert: fs.readFileSync("keys-for-local-https/localhost.pem"),
};

let HTTPSserver = https.createServer(options, app);

const { Server } = require("socket.io"); // include library
const io = new Server(HTTPSserver); // start socket io

// socket.id -> { userId, username }
let sockets = {};

let messages = [];

io.on("connection", (socket) => {
  // we manage the connection inside here
  console.log("a user connected", socket.id);

  socket.on("identify", function (data) {
    // connect username and user id to socket ids
    sockets[socket.id] = data;
    console.log(sockets);

    // could update other about who's online
    socket.emit("chat-history", messages);
  });

  socket.on("name-change", function (data) {
    // handle change of username
  });

  socket.on("message-from-client", function (data) {
    console.log("got a msg from client", data);

    // message object should contain message, username and userID
    let message = {
      text: data.message,
      sender: sockets[socket.id],
    };

    messages.push(message);
    io.emit("message-from-server", message);
  });

  socket.on("disconnect", function () {
    console.log("someone disconnected", socket.id);

    // delete user from our records
    delete sockets[socket.id];
    console.log(sockets);

    console.log("online socket", sockets);
  });
});

// Creating servers and make them listen at their ports:

HTTPSserver.listen(portHTTPS, function (req, res) {
  console.log("HTTPS Server started at port", portHTTPS);
});
