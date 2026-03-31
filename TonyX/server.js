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

const PORT = 4240;

const headCx = 0.2;
const headCy = -0.38;
const ellipseRx = 0.17;
const ellipseRy = 0.11;
const tilt = 0.5;
const size = 300;
const imgBuf = fs.readFileSync("public/assets/JingWu01.png");
const imgAsp = imgBuf.readUInt32BE(20) / imgBuf.readUInt32BE(16);

function randomHeadOffset() {
  let angle = Math.random() * Math.PI * 2;
  let r = Math.sqrt(Math.random());
  let ex = ellipseRx * r * Math.cos(angle);
  let ey = ellipseRy * r * Math.sin(angle);

  let pxX = ex * size;
  let pxY = ey * size * imgAsp;
  let rx = pxX * Math.cos(tilt) - pxY * Math.sin(tilt);
  let ry = pxX * Math.sin(tilt) + pxY * Math.cos(tilt);
  return {
    headOffsetX: headCx * size + rx,
    headOffsetY: headCy * size * imgAsp + ry,
  };
}

let players = {};
let traces = {};

io.on("connection", (socket) => {
  console.log("connected", socket.id);

  let offset = randomHeadOffset();
  let traceID = socket.id;

  traces[traceID] = {
    headOffsetX: offset.headOffsetX,
    headOffsetY: offset.headOffsetY,
    color: "#000000",
    originLat: null,
    originLon: null,
    points: [],
  };

  players[socket.id] = {
    traceID,
    headOffsetX: offset.headOffsetX,
    headOffsetY: offset.headOffsetY,
    color: "#000000",
    currentLat: 0,
    currentLon: 0,
  };

  socket.emit("connected", {
    socketID: socket.id,
    traceID,
    headOffsetX: offset.headOffsetX,
    headOffsetY: offset.headOffsetY,
    color: "#000000",
    traces: traces,
    onlinePlayers: Object.fromEntries(
      Object.entries(players).map(([sid, p]) => [
        sid,
        {
          traceID: p.traceID,
          color: p.color,
          currentLat: p.currentLat,
          currentLon: p.currentLon,
        },
      ]),
    ),
  });

  socket.broadcast.emit("newPlayer", {
    socketID: socket.id,
    traceID,
    headOffsetX: offset.headOffsetX,
    headOffsetY: offset.headOffsetY,
    color: "#000000",
  });

  socket.on("registerOrigin", function (data) {
    traces[traceID].originLat = data.originLat;
    traces[traceID].originLon = data.originLon;

    socket.broadcast.emit("traceOrigin", {
      traceID,
      originLat: data.originLat,
      originLon: data.originLon,
    });
  });

  socket.on("locationFromClient", function (data) {
    let p = players[socket.id];
    if (!p) return;
    p.currentLat = data.lat;
    p.currentLon = data.lon;

    traces[traceID].points.push({ lat: data.lat, lon: data.lon });

    socket.broadcast.emit("locationFromServer", {
      socketID: socket.id,
      traceID,
      lat: data.lat,
      lon: data.lon,
    });
  });

  socket.on("disconnect", function () {
    console.log("disconnected", socket.id);
    socket.broadcast.emit("deletePlayer", { socketID: socket.id });
    delete players[socket.id];
  });
});

HTTPSserver.listen(PORT, function () {
  console.log("HTTPS server listening on port", PORT);
});
