const express = require("express");

const https = require("https");
// to read certificates from the filesystem (fs)
const fs = require("fs");

const app = express(); // the server "app", the server behaviour
const portHTTPS = 3010; // port for https

// returning to the client anything that is
// inside the public folder
app.use(express.static("public"));

// Creating object of key and certificate
// for SSL
const options = {
  key: fs.readFileSync("localhost-key.pem"),
  cert: fs.readFileSync("localhost.pem"),
};

let HTTPSserver = https.createServer(options, app);

const { Server } = require("socket.io"); // include library
const io = new Server(HTTPSserver); // start socket io

// socket.id -> { userId, username }
let sockets = {};

let locations = [];

let dataText = fs.readFileSync("locationData.json", "utf8");
locations = JSON.parse(dataText);
// get locations stored in the json file
// and add them to the locations array

io.on("connection", (socket) => {
  // we manage the connection inside here
  console.log("a user connected", socket.id);

  socket.on("identify", function (data) {
    // connect username and user id to socket ids
    sockets[socket.id] = data;
    // console.log(sockets);

    // send all locations to user
    socket.emit("historical-locations", locations);
  });

  socket.on("location-from-client", function (data) {
    // console.log("got location", data);

    // get userID and name hue
    let userData = sockets[socket.id];
    // console.log(userData);

    // data to add to location array
    // & JSON file
    // & send to ever user online
    let locationData = {
      lat: data.lat,
      lng: data.lng,
      userId: userData.userId,
      username: userData.username,
      userHue: userData.userHue,
    };
    locations.push(locationData);
    console.log(locations);
    let dataAsText = JSON.stringify(locations, null, 2);
    fs.writeFileSync("locationData.json", dataAsText, "utf8");

    io.emit("location-from-server", locationData);

    // store location along with userdata to json file and location array

    // send new location to everybody
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
