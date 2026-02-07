const express = require("express");
// const http = require("http"); // we try to make HTTPS work

const https = require("https");
// to read certificates from the filesystem (fs)
const fs = require("fs");

const app = express(); // the server "app", the server behaviour

const portHTTPS = 3000; // port for https
// const portHTTP = 3001; // port for http

// returning to the client anything that is
// inside the public folder
app.use(express.static("public"));

// Creating object of key and certificate
// for SSL
const options = {
  key: fs.readFileSync("keys-for-local-https/localhost-key.pem"),
  cert: fs.readFileSync("keys-for-local-https/localhost.pem"),
};

const HTTPSserver = https.createServer(options, app);
const { Server } = require("socket.io"); // include library
const io = new Server(HTTPSserver); // start socket.io server

// handling socket.io connections
io.on("connection", (socket) => {
  console.log("a user connected:");

  // only 2 users
  if (userCount >= 2) {
    socket.emit("roomFull");
    socket.disconnect();
    return;
  }
  userCount++;
  console.log("user joined, count:", userCount);

  socket.on("MessageFromClient", function (incomingMessageData) {
    console.log(incomingMessageData);

    // // SEND MESSAGE TO ALL OTHER CONNECTED CLIENTS
    // let messageToAllClients = {
    //     sender:"unknown",
    //     message: incomingMessage
    // }

    // Server emits to all connected clients
    io.emit("MessageFromServer", incomingMessageData);
  });

  socket.on("disconnect", () => {
    console.log("user disconnected");
  });
});

// Creating servers and make them listen at their ports:
HTTPSserver.listen(portHTTPS, function (req, res) {
  console.log("HTTPS Server started at port", portHTTPS);
});

// if we ALSO serve on http we can incommend this, but right now we don't
// http.createServer(app).listen(portHTTP, function (req, res) {
//     console.log("HTTP Server started at port", portHTTP);
// });
