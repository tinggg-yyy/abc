const express = require("express");

const https = require("https");
// to read certificates from the filesystem (fs)
const fs = require("fs");

const app = express(); // the server "app", the server behaviour
const portHTTPS = 4280; // port for https

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
let connections = [];

let dataText = fs.readFileSync("locationData.json", "utf8");
locations = JSON.parse(dataText);

let connText = fs.readFileSync("connectionData.json", "utf8");
let connData = JSON.parse(connText);
connections = connData.connections || [];
let messages = connData.messages || [];
let brokenConnections = connData.brokenConnections || []; // array of sorted "A|B" pair keys

io.on("connection", (socket) => {
  // we manage the connection inside here
  console.log("a user connected", socket.id);

  // populate immediately from auth so buffered events work before identify arrives
  if (socket.handshake.auth && socket.handshake.auth.userId) {
    sockets[socket.id] = socket.handshake.auth;
  }

  socket.on("identify", function (data) {
    // connect username and user id to socket ids
    sockets[socket.id] = data;

    // send all locations, connections, and messages to new user
    socket.emit("historical-locations", locations);
    socket.emit("historical-connections", connections);
    socket.emit("historical-messages", messages);
    socket.emit("historical-broken-connections", brokenConnections);

    // only announce if this is a genuinely new user (no saved location = first time)
    let existingLoc = locations.find((l) => l.userId === data.userId);
    if (!existingLoc) {
      io.emit("new-user-joined", {
        userId: data.userId,
        username: data.username,
        userHue: data.userHue,
      });
    }

    // if this user already has a saved location, broadcast it so others see them immediately
    if (existingLoc) {
      io.emit("location-from-server", existingLoc);
    }
  });

  socket.on("location-from-client", function (data) {
    console.log("location-from-client received:", data);
    console.log("sockets dict:", sockets);
    // get userID and name hue
    let userData = sockets[socket.id];
    if (!userData) return;
    // console.log(userData);
    // data to add to location array
    // & JSON file
    // & send to ever user online
    // store location along with userdata to json file and location array
    let locationData = {
      lat: data.lat,
      lng: data.lng,
      userId: userData.userId,
      username: userData.username,
      userHue: userData.userHue,
    };

    // only one point each user
    let existingIndex = null;
    for (let i = 0; i < locations.length; i++) {
      if (locations[i].userId === userData.userId) {
        existingIndex = i;
        break;
      }
    }
    if (existingIndex !== null) {
      locations[existingIndex] = locationData;
    } else {
      locations.push(locationData);
    }
    console.log(locations);
    let dataAsText = JSON.stringify(locations, null, 2);
    fs.writeFileSync("locationData.json", dataAsText, "utf8");
    // send new location to everybody
    io.emit("location-from-server", locationData);
  });

  // handle connection data from client
  socket.on("connection-from-client", function (data) {
    let userData = sockets[socket.id];
    if (!userData) return;

    // remove existing connection for this user
    let existingIndex = null;
    for (let i = 0; i < connections.length; i++) {
      if (connections[i].fromUserId === userData.userId) {
        existingIndex = i;
        break;
      }
    }

    if (data.toUserId === null) {
      // deselected — remove connection
      if (existingIndex !== null) {
        connections.splice(existingIndex, 1);
      }
    } else {
      let connData = { fromUserId: userData.userId, toUserId: data.toUserId };
      if (existingIndex !== null) {
        connections[existingIndex] = connData;
      } else {
        connections.push(connData);
      }
    }
    
    fs.writeFileSync(
      "connectionData.json",
      JSON.stringify({ connections, messages, brokenConnections }, null, 2),
      "utf8",
    );
    io.emit("connections-from-server", connections);
  });

  socket.on("message-travel", function (data) {
    let userData = sockets[socket.id];
    if (!userData) return;
    let msgData = {
      fromUserId: userData.userId,
      toUserId: data.toUserId,
      text: data.text,
      timestamp: new Date().toISOString(),
    };
    messages.push(msgData);
    fs.writeFileSync(
      "connectionData.json",
      JSON.stringify({ connections, messages, brokenConnections }, null, 2),
      "utf8",
    );
    io.emit("message-travel", msgData);
  });

  socket.on("chat-message", function (data) {
    let userData = sockets[socket.id];
    if (!userData) return;
    let msgData = {
      fromUserId: userData.userId,
      username: userData.username,
      userHue: userData.userHue,
      text: data.text,
      timestamp: new Date().toISOString(),
    };
    io.emit("chat-message", msgData);
  });

  socket.on("break-connection", function (data) {
    const key = [data.userId1, data.userId2].sort().join("|");
    if (!brokenConnections.includes(key)) {
      brokenConnections.push(key);
      fs.writeFileSync(
        "connectionData.json",
        JSON.stringify({ connections, messages, brokenConnections }, null, 2),
        "utf8",
      );
      io.emit("broken-connection-from-server", { key });
    }
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
