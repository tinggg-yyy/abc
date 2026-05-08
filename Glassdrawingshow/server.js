const express = require("express");
// const http = require("http"); // we try to make HTTPS work

const https = require("https");
// to read certificates from the filesystem (fs)
const fs = require("fs");

const app = express(); // the server "app", the server behaviour

const portHTTPS = 4281; // port for https
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
// let userCount = 0;

// handling socket.io connections
io.on("connection", (socket) => {
  // console.log("a user connected:");

  // only 2 users
  // if (userCount >= 2) {
  //   socket.emit("roomFull");
  //   socket.disconnect();
  //   return;
  // }
  // userCount++;
  // console.log("user joined, count:", userCount);

  // Later, if > 2 users, arrange them in other rooms

  // socket.on("DrawingFromClient", function (incomingDrawingData) {
  //   console.log(incomingDrawingData);
  //   //  send message to all clients, except the sender (except that socket)
  //   socket.broadcast.emit("DrawingFromServer", incomingDrawingData); // send to all other clients except the sender
  //   // // SEND MESSAGE TO ALL OTHER CONNECTED CLIENTS
  //   // let messageToAllClients = {
  //   //     sender:"unknown",
  //   //     message: incomingMessage
  //   // }
  // });

  socket.on("new-line-started", function (point) {
    socket.broadcast.emit("new-line-started", {
      point: point,
      userId: socket.id,
    });
    // console.log("new line started at", point);
  });

  socket.on("new-point-on-line", function (point) {
    socket.broadcast.emit("new-point-on-line", {
      point: point,
      userId: socket.id,
    });
    // console.log("new point on line at", point);
  });

  socket.on("new-line-finished", function (finished) {
    socket.broadcast.emit("new-line-finished", {
      finished: finished,
      userId: socket.id,
    });
    // console.log("line finished", finished);
  });

  socket.on("user-breathed", function () {
    socket.broadcast.emit("user-breathed", {
      userId: socket.id,
    });
    // console.log("user breathed");
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
