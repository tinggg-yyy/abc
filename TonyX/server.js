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
const size = 300;

const heroConfigs = {
  jingwu: {
    imgFile: "public/assets/JingWu01.png",
    headCx: 0.2,
    headCy: -0.38,
    ellipse_rx: 0.17,
    ellipse_ry: 0.11,
    tilt: 0.5,
  },
schwarzenegger: {
  imgFile: "public/assets/Schwarzenegger.png",
  headCx: -0.1,
  headCy: -0.24,
  ellipse_rx: 0.01,
  ellipse_ry: 0.01,
  tilt: 0.0,
},
};

const heroMeta = {};
for (const [key, h] of Object.entries(heroConfigs)) {
  const buf = fs.readFileSync(h.imgFile);
  const imgAsp = buf.readUInt32BE(20) / buf.readUInt32BE(16);
  heroMeta[key] = { ...h, imgAsp };
}

function randomHeadOffset(heroKey) {
  const h = heroMeta[heroKey] || heroMeta.jingwu;
  const { headCx, headCy, ellipse_rx, ellipse_ry, tilt, imgAsp } = h;
  let angle = Math.random() * Math.PI * 2;
  let r = Math.sqrt(Math.random());
  let ex = ellipse_rx * r * Math.cos(angle);
  let ey = ellipse_ry * r * Math.sin(angle);
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

  socket.on("selectHero", function (data) {
    const heroKey =
      data.hero === "schwarzenegger" ? "schwarzenegger" : "jingwu";
    let offset = randomHeadOffset(heroKey);
    let traceID = socket.id;

    traces[traceID] = {
      headOffsetX: offset.headOffsetX,
      headOffsetY: offset.headOffsetY,
      color: "#000000",
      heroKey,
      originLat: null,
      originLon: null,
      points: [],
    };

    players[socket.id] = {
      traceID,
      heroKey,
      headOffsetX: offset.headOffsetX,
      headOffsetY: offset.headOffsetY,
      color: "#000000",
      currentLat: 0,
      currentLon: 0,
    };

    socket.emit("connected", {
      socketID: socket.id,
      traceID,
      heroKey,
      headOffsetX: offset.headOffsetX,
      headOffsetY: offset.headOffsetY,
      color: "#000000",
      traces: traces,
      onlinePlayers: Object.fromEntries(
        Object.entries(players).map(([sid, p]) => [
          sid,
          {
            traceID: p.traceID,
            heroKey: p.heroKey,
            color: p.color,
            currentLat: p.currentLat,
            currentLon: p.currentLon,
          },
        ])
      ),
    });

    socket.broadcast.emit("newPlayer", {
      socketID: socket.id,
      traceID,
      heroKey,
      headOffsetX: offset.headOffsetX,
      headOffsetY: offset.headOffsetY,
      color: "#000000",
    });
  });

  socket.on("registerOrigin", function (data) {
    let p = players[socket.id];
    if (!p) return;
    let traceID = p.traceID;
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

    let traceID = p.traceID;
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