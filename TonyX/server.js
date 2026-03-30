// GPS HAIR PROJECT — server.js

const express = require("express");
const https = require("https");
const fs = require("fs");

const app = express();
app.use(express.static("public"));

const options = {
  key: fs.readFileSync("localhost-key.pem"),
  cert: fs.readFileSync("localhost.pem"),
};
const HTTPSserver = https.createServer(options, app);
const { Server } = require("socket.io");
const io = new Server(HTTPSserver);

const PORT = 4280;
const COLOR = "#000000";

// Scalp ellipse parameters — must match sketch.js
const HEAD_CX = 0.2;
const HEAD_CY = -0.38;
const ELLIPSE_RX = 0.17;
const ELLIPSE_RY = 0.11;
const TILT = 0.5;
const INIT_SIZE = 300;

// Place the hair root at a random point within the scalp ellipse
function randomHeadOffset() {
  let angle = Math.random() * Math.PI * 2;
  let r = Math.sqrt(Math.random());
  let ex = ELLIPSE_RX * r * Math.cos(angle);
  let ey = ELLIPSE_RY * r * Math.sin(angle);
  let rx = ex * Math.cos(TILT) - ey * Math.sin(TILT);
  let ry = ex * Math.sin(TILT) + ey * Math.cos(TILT);
  return {
    headOffsetX: (HEAD_CX + rx) * INIT_SIZE,
    headOffsetY: (HEAD_CY + ry) * INIT_SIZE,
  };
}

let players = {};
let persistedTraces = {};
let globalOriginLat = null;
let globalOriginLon = null;

// -------------------------------------------------------------
//  SOCKET EVENTS
// -------------------------------------------------------------
io.on("connection", (socket) => {
  console.log("connected", socket.id);

  let offset = randomHeadOffset();
  let traceID = socket.id;

  persistedTraces[traceID] = {
    headOffsetX: offset.headOffsetX,
    headOffsetY: offset.headOffsetY,
    color: COLOR,
    originLat: null,
    originLon: null,
    points: [],
  };

  players[socket.id] = {
    traceID,
    headOffsetX: offset.headOffsetX,
    headOffsetY: offset.headOffsetY,
    color: COLOR,
    currentLat: 0,
    currentLon: 0,
  };

  socket.emit("welcome", {
    socketID: socket.id,
    traceID,
    headOffsetX: offset.headOffsetX,
    headOffsetY: offset.headOffsetY,
    color: COLOR,
  });

  // Send full trace history + current online players to the newcomer
  socket.emit("initData", {
    traces: persistedTraces,
    myTraceID: traceID,
    globalOriginLat,
    globalOriginLon,
    onlinePlayers: Object.fromEntries(
      Object.entries(players).map(([sid, p]) => [
        sid,
        {
          traceID: p.traceID,
          headOffsetX: p.headOffsetX,
          headOffsetY: p.headOffsetY,
          color: p.color,
          currentLat: p.currentLat,
          currentLon: p.currentLon,
        },
      ]),
    ),
  });

  // Notify existing clients of the new player
  socket.broadcast.emit("playerJoined", {
    socketID: socket.id,
    traceID,
    headOffsetX: offset.headOffsetX,
    headOffsetY: offset.headOffsetY,
    color: COLOR,
  });

  // First GPS fix — register the trace origin
  socket.on("registerOrigin", function (data) {
    persistedTraces[traceID].originLat = data.originLat;
    persistedTraces[traceID].originLon = data.originLon;
    players[socket.id].originLat = data.originLat;
    players[socket.id].originLon = data.originLon;

    // First user to register sets the global head position for everyone
    if (globalOriginLat === null) {
      globalOriginLat = data.originLat;
      globalOriginLon = data.originLon;
      io.emit("globalOrigin", { lat: globalOriginLat, lon: globalOriginLon });
    }

    socket.broadcast.emit("traceOrigin", {
      traceID,
      originLat: data.originLat,
      originLon: data.originLon,
    });
  });

  // Continuous location updates
  socket.on("locationFromClient", function (data) {
    let p = players[socket.id];
    if (!p) return;
    p.currentLat = data.lat;
    p.currentLon = data.lon;

    persistedTraces[traceID].points.push({ lat: data.lat, lon: data.lon });

    socket.broadcast.emit("locationFromServer", {
      socketID: socket.id,
      traceID,
      lat: data.lat,
      lon: data.lon,
    });
  });

  // Remove live session; keep trace history
  socket.on("disconnect", function () {
    console.log("disconnected", socket.id);
    socket.broadcast.emit("deletePerson", { socketID: socket.id });
    delete players[socket.id];
  });
});

HTTPSserver.listen(PORT, function () {
  console.log("HTTPS server listening on port", PORT);
});
