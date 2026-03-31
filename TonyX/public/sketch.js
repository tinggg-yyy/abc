const size = 300;
const zoom = 16;

let mappa = new Mappa("Leaflet");
let myMap;
let canvas;
let mapInit = false;

let currentLat = 0;
let currentLon = 0;
let myHeading = 0;
let myOriginLat = null;
let myOriginLon = null;

let heroImg;
let heroData;

let traces = {};
let myTraceID = null;
let mySocketID = null;

let onlinePlayers = {};

let socket;

let homeBtn;

if (
  location.hostname.toLowerCase().startsWith("browsercircus") ||
  location.hostname.toLowerCase().startsWith("www")
) {
  socket = io({ path: "/luna/port-4240/socket.io" });
} else {
  socket = io();
}

let mappa_options = {
  lat: 0,
  lng: 0,
  zoom: zoom,
  style:
    "https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}",
};

function preload() {
  heroImg = loadImage("assets/JingWu01.png");
}

function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");
  textAlign(CENTER, CENTER);
  textSize(11);

homeBtn = createButton("🌍");
homeBtn.position(width - 48, 12);
homeBtn.size(36, 36);

homeBtn.style("position", "fixed");
homeBtn.style("z-index", "9999");
homeBtn.style("pointer-events", "auto");
homeBtn.style("cursor", "pointer");

homeBtn.style("font-size", "20px");
homeBtn.style("background", "transparent");
homeBtn.style("border", "none");
homeBtn.style("outline", "none");
homeBtn.style("padding", "0");

homeBtn.mousePressed(calibration);
}

function draw() {
  clear();

  if (!mapInit && GPS_GRANTED && currentLon !== 0) {
    mappa_options.lat = currentLat;
    mappa_options.lng = currentLon;
    myMap = mappa.tileMap(mappa_options);
    myMap.overlay(canvas);
    myMap.onChange(onMapChange);
    mapInit = true;

    onMapChange();
  }

  noStroke();

  if (mapInit) {
    if (heroData) heroData.display(); // 只在这里 display，recalculate 已由 onMapChange 做过
    for (let id in traces) playerTrace(traces[id]);
    for (let sid in onlinePlayers) {
      if (onlinePlayers[sid].dot) onlinePlayers[sid].dot.display();
    }
  }

  drawLabels();
}

function calibration() {
  if (!mapInit || !myMap || !myMap.map) return;
  if (myOriginLat === null || myOriginLon === null) return;
  myMap.map.setView([myOriginLat, myOriginLon], zoom, { animate: false });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  if (mapInit) onMapChange();
}

function handleNewPosition(pos) {
  let lonlat = fixForChineseMap(pos);
  currentLon = lonlat[0];
  currentLat = lonlat[1];
  if (pos.coords.heading != null) myHeading = pos.coords.heading;

  if (myOriginLat === null) {
    myOriginLat = currentLat;
    myOriginLon = currentLon;
    heroData = new ImageData(myOriginLat, myOriginLon, heroImg);

    socket.emit("registerOrigin", {
      originLat: myOriginLat,
      originLon: myOriginLon,
    });

    if (myTraceID && traces[myTraceID]) {
      traces[myTraceID].originLat = myOriginLat;
      traces[myTraceID].originLon = myOriginLon;
      if (mapInit) recalcTrace(traces[myTraceID]);
    }
  }

  if (myTraceID && traces[myTraceID]) {
    addPointToTrace(traces[myTraceID], currentLat, currentLon);
  }

  if (
    mySocketID &&
    onlinePlayers[mySocketID] &&
    onlinePlayers[mySocketID].dot
  ) {
    let dot = onlinePlayers[mySocketID].dot;
    dot.currentLat = currentLat;
    dot.currentLon = currentLon;
    if (mapInit) dot.recalculate();
  }

  socket.emit("locationFromClient", { lat: currentLat, lon: currentLon });
  if (mapInit) onMapChange();
}

function onMapChange() {
  if (!myMap || !myMap.map) return;
  // 只重算坐标，不 display
  if (heroData) heroData.recalculate();
  for (let id in traces) recalcTrace(traces[id]);
  for (let sid in onlinePlayers) {
    if (onlinePlayers[sid].dot) onlinePlayers[sid].dot.recalculate();
  }
}

function gpsToScreen(traceData, lat, lon) {
  if (
    !mapInit ||
    !myMap ||
    !myMap.map ||
    !traceData.originLat ||
    myOriginLat === null
  )
    return null;

  let scale = Math.pow(2, myMap.map.getZoom() - zoom);
  let hx = traceData.headOffsetX * scale;
  let hy = traceData.headOffsetY * scale;
  let originPx = myMap.latLngToPixel(traceData.originLat, traceData.originLon);
  let pointPx = myMap.latLngToPixel(lat, lon);
  let myOriginPx = myMap.latLngToPixel(myOriginLat, myOriginLon);

  return {
    x: myOriginPx.x + hx + (pointPx.x - originPx.x),
    y: myOriginPx.y + hy + (pointPx.y - originPx.y),
  };
}

function addPointToTrace(traceData, lat, lon) {
  let last = traceData.points[traceData.points.length - 1];
  if (
    last &&
    Math.abs(last.lat - lat) < 1e-7 &&
    Math.abs(last.lon - lon) < 1e-7
  )
    return;
  traceData.points.push({ lat, lon });
  if (mapInit && traceData.originLat) {
    let px = gpsToScreen(traceData, lat, lon);
    if (px) traceData.pxPoints.push(px);
  }
}

function recalcTrace(traceData) {
  if (!mapInit || !traceData.originLat) return;
  traceData.pxPoints = traceData.points
    .map((p) => gpsToScreen(traceData, p.lat, p.lon))
    .filter(Boolean);
}

socket.on("connected", function (data) {
  mySocketID = data.socketID;
  myTraceID = data.traceID;

  traces[myTraceID] = {
    headOffsetX: data.headOffsetX,
    headOffsetY: data.headOffsetY,
    color: data.color,
    originLat: null,
    originLon: null,
    points: [],
    pxPoints: [],
  };

  onlinePlayers[mySocketID] = {
    traceID: myTraceID,
    dot: new playerDot(data.color, myTraceID, true),
  };

  for (let id in data.traces) {
    if (id === myTraceID) continue;
    let td = data.traces[id];
    traces[id] = {
      headOffsetX: td.headOffsetX,
      headOffsetY: td.headOffsetY,
      color: td.color,
      originLat: td.originLat || null,
      originLon: td.originLon || null,
      points: td.points || [],
      pxPoints: [],
    };
  }

  for (let sid in data.onlinePlayers) {
    if (sid === mySocketID) continue;
    let op = data.onlinePlayers[sid];
    onlinePlayers[sid] = {
      traceID: op.traceID,
      dot: new playerDot(op.color, op.traceID, false),
    };
    onlinePlayers[sid].dot.currentLat = op.currentLat;
    onlinePlayers[sid].dot.currentLon = op.currentLon;
    if (mapInit) onlinePlayers[sid].dot.recalculate();
  }

  if (mapInit) onMapChange();
});

socket.on("newPlayer", function (data) {
  if (!traces[data.traceID]) {
    traces[data.traceID] = {
      headOffsetX: data.headOffsetX,
      headOffsetY: data.headOffsetY,
      color: data.color,
      originLat: null,
      originLon: null,
      points: [],
      pxPoints: [],
    };
  }
  onlinePlayers[data.socketID] = {
    traceID: data.traceID,
    dot: new playerDot(data.color, data.traceID, false),
  };
});

socket.on("traceOrigin", function (data) {
  if (!traces[data.traceID]) return;
  traces[data.traceID].originLat = data.originLat;
  traces[data.traceID].originLon = data.originLon;
  if (mapInit) recalcTrace(traces[data.traceID]);
});

socket.on("locationFromServer", function (data) {
  let td = traces[data.traceID];
  if (!td) return;
  addPointToTrace(td, data.lat, data.lon);

  let op = onlinePlayers[data.socketID];
  if (op && op.dot) {
    op.dot.currentLat = data.lat;
    op.dot.currentLon = data.lon;
    if (mapInit) op.dot.recalculate();
  }
});

socket.on("deletePlayer", function (data) {
  delete onlinePlayers[data.socketID];
});

function playerTrace(td) {
  if (td.pxPoints.length === 0) return;
  push();
  if (td.pxPoints.length >= 2) {
    noFill();
    stroke(td.color);
    strokeWeight(4);
    strokeCap(ROUND);
    strokeJoin(ROUND);
    beginShape();
    for (let i = 0; i < td.pxPoints.length; i++) {
      let p = td.pxPoints[i];
      if (i === 0) curveVertex(p.x, p.y);
      curveVertex(p.x, p.y);
      if (i === td.pxPoints.length - 1) curveVertex(p.x, p.y);
    }
    endShape();
  }
  let root = td.pxPoints[0];
  noStroke();
  fill(td.color);
  circle(root.x, root.y, 8);
  pop();
}

class ImageData {
  constructor(lat, lon, img) {
    this.lat = lat;
    this.lon = lon;
    this.img = img;
    this.x = 0;
    this.y = 0;
    this.w = size;
    this.h = size * (img.height / img.width);
  }

  recalculate() {
    if (!mapInit || !myMap || !myMap.map) return;
    let pos = myMap.latLngToPixel(this.lat, this.lon);
    let scale = Math.pow(2, myMap.map.getZoom() - zoom);
    this.x = pos.x;
    this.y = pos.y;
    this.w = size * scale;
    this.h = size * (this.img.height / this.img.width) * scale;
  }

  display() {
    push();
    imageMode(CENTER);
    image(this.img, this.x, this.y, this.w, this.h);
    pop();
  }
}

class playerDot {
  constructor(col, traceID, isMe) {
    this.col = col;
    this.traceID = traceID;
    this.isMe = isMe;
    this.currentLat = 0;
    this.currentLon = 0;
    this.x = null;
    this.y = null;
    this.goalX = null;
    this.goalY = null;
  }

  recalculate() {
    if (!mapInit || this.currentLat === 0) return;
    let td = traces[this.traceID];
    if (!td || td.originLat === undefined) return;
    let px = gpsToScreen(td, this.currentLat, this.currentLon);
    if (px) {
      this.goalX = px.x;
      this.goalY = px.y;
    }
  }

  display() {
    if (this.goalX === null) return;
    if (this.x === null) {
      this.x = this.goalX;
      this.y = this.goalY;
    }
    this.x = lerp(this.x, this.goalX, 0.2);
    this.y = lerp(this.y, this.goalY, 0.2);
    push();
    if (this.isMe) {
      translate(this.x, this.y);
      rotate(radians(myHeading));
      stroke(255);
      strokeWeight(2);
      fill(this.col);
      triangle(0, -16, -8, 9, 8, 9);
      noStroke();
      fill(255);
      circle(0, 3, 5);
    } else {
      noStroke();
      fill(0);
      circle(this.x, this.y, 8);
    }
    pop();
  }
}

function drawLabels() {
  if (!mapInit) return;
  let labels = [
    "Hairs: " + Object.keys(traces).length,
    "Tonies: " + Object.keys(onlinePlayers).length,
  ];
  let pad = 8;
  let boxH = 24;
  let gap = 6;
  push();
  textSize(11);
  for (let i = 0; i < labels.length; i++) {
    let boxW = textWidth(labels[i]) + pad * 2;
    let bx = width - boxW - pad;
    let by = height - (boxH + gap) * (labels.length - i) - pad;
    noStroke();
    fill(255);
    rect(bx, by, boxW, boxH);
    fill(0);
    textAlign(LEFT, CENTER);
    text(labels[i], bx + pad, by + boxH / 2);
  }
  pop();
}