let mappa = new Mappa("Leaflet"); // map library
let myMap;
let canvas;
let currentLongitude = 0; // global variables will be updated as we get GPS data
let currentLatitude = 0; // global variables will be updated as we get GPS data
let mapInit = false; // we only do map stuff once mapInit is true (see in draw)
let me; // point object showing our own location
let others = [];
let socket;
// let socket = io();  // yields '/leon/port-4100/socket.io' or '/socket.io'
if (location.hostname.toLowerCase().startsWith("browsercircus")) {
  socket = io({ path: "/gps-see-everyone/socket.io" }); // yields '/leon/port-4100/socket.io' or '/socket.io'
} else {
  socket = io();
}

// options for map
// we only actually initialize the map once we get data where we are (in draw)
// there are differnt suppliers and styles of maps available
let mappa_options = {
  lat: 0, // will change once we have data
  lng: 0, // will change once we have data
  zoom: 16, // initial zoom level
  // style: "https://b.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
  style:
    "https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}",
  // style: 'https://webst01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=6&x={x}&y={y}&z={z}',
};

function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");
  me = new Person("ME");
  // someone = new Person();

  // let g = new Person("someone");
  // g.lat = 31.217739076607155;
  // g.lon = 121.4242046585646;
  // others.push(g)
}

function draw() {
  clear();

  // Initialize full screen map
  // runs only once to init the map
  if (!mapInit && GPS_GRANTED && currentLongitude != 0) {
    // console.log("starting map");
    mappa_options.lat = currentLatitude;
    mappa_options.lng = currentLongitude;
    myMap = mappa.tileMap(mappa_options);
    myMap.overlay(canvas);
    myMap.onChange(updateMapContent);
    mapInit = true;
  }
  noStroke();
  fill(0, 160);
  rect(0, 0, width, height);
  if (mapInit) {
    // only update and draw our point if we actually have data
    me.update();
    me.display();
    // console.log(me)
    for (o of others) {
      o.update();
      o.display();
    }
    drawPointers(others);
    drawPointers([me]);
  }
}

// P5 touch events: https://p5js.org/reference/#Touch
function touchStarted() {
  if (mapInit) {
    let pos = myMap.pixelToLatLng(touches[0].x, touches[0].y);
    console.log("TOUCHED", pos);
  } else {
    console.log("TOUCHED", touches);
  }
}

function touchMoved() {}

function touchEnded() {}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function drawPointers(points) {
  for (p of points) {
    if (!checkIfOnMap(p.lat, p.lon) && myMap.map) {
      // console.log("center",  myMap.map.getCenter() )
      // let center = myMap.map.getCenter()
      // let centerXY = myMap.latLngToPixel(center.lat, center.lng);
      // console.log(centerXY);
      let dx = p.x - width / 2;
      let dy = p.y - height / 2; // use -dy if you want 0° = right, CCW positive
      let angRad = Math.atan2(dy, dx); // radians, 0 = right, CW positive with screen y
      // let angDeg = angRad * 180/Math.PI;
      // text(angDeg, p.x, 20)
      let pointerPos = pointOnRectEdge(10, width - 10, 10, height - 10, angRad);
      // circle(pointerPos.x, pointerPos.y, 10)
      push();
      translate(pointerPos.x, pointerPos.y);
      rotate(angRad - PI / 2);
      scale(1.4);
      fill(color(170, 240, 190));
      stroke("pink");
      strokeWeight(3);
      triangle(-4, -4, 0, 4, 4, -4);
      pop();
      // console.log("point on edge", pointOnRectEdge(0, width, 0, height, angRad))
    }
  }
}

// Below function by chatGPT:
function pointOnRectEdge(x1, x2, y1, y2, angle) {
  const cx = (x1 + x2) / 2,
    cy = (y1 + y2) / 2;
  const dx = Math.cos(angle),
    dy = Math.sin(angle); // screen coords: y down

  // Avoid division by zero
  const EPS = 1e-12;
  const sdx = Math.abs(dx) < EPS ? 0 : dx;
  const sdy = Math.abs(dy) < EPS ? 0 : dy;

  // Param to hit vertical sides
  let tx = Infinity;
  if (sdx !== 0) tx = dx > 0 ? (x2 - cx) / dx : (x1 - cx) / dx;

  // Param to hit horizontal sides
  let ty = Infinity;
  if (sdy !== 0) ty = dy > 0 ? (y2 - cy) / dy : (y1 - cy) / dy;

  const t = Math.min(tx, ty);
  return { x: cx + t * dx, y: cy + t * dy };
}

// directly called from GPS listener whenever our location updates:
function handleNewPosition(pos) {
  // fix location for chinese map tiles
  let lonlat = fixForChineseMap(pos);
  currentLongitude = lonlat[0];
  currentLatitude = lonlat[1];
  // console.log(currentLatitude, currentLongitude);

  me.lon = currentLongitude;
  me.lat = currentLatitude;

  let locForServer = {
    lat: currentLatitude,
    lon: currentLongitude,
  };
  // console.log("me", socket.id);
  socket.emit("locationFromClient", locForServer);

  if (mapInit) {
    // if map already displayed, update the point
    updateMapContent();
  }
}

function checkIfOnMap(lat, lon) {
  console.log("checking ig ", lat, lon, "on map");
  if (mapInit && myMap.map) {
    // console.log(myMap)
    let bounds = myMap.map.getBounds();
    return bounds.contains([lat, lon]);
  } else {
    // console.log("can calc bounds, no map")
    return false;
  }
}

socket.on("locationFromServer", function (data) {
  // console.log("data from someone", data);

  let idx = others.findIndex((o) => o.id === data.socketID);
  // console.log(others, data.socketID, idx)
  if (idx > -1) {
    // console.log("already known")
    others[idx].lat = data.lat;
    others[idx].lon = data.lon;
    others[idx].recalculatePosition();
  } else {
    // console.log("new person")
    let o = new Person(data.socketID);
    o.lat = data.lat;
    o.lon = data.lon;
    o.recalculatePosition();
    others.push(o);
  }
});

socket.on("deletePerson", function (data) {
  let idx = others.findIndex((o) => o.id === data.socketID);
  if (idx > -1) {
    others.splice(idx, 1);
  }
});

function updateMapContent() {
  // let myPosOnCanvas = myMap.latLngToPixel(currentLatitude, currentLongitude)
  // me.goalX = myPosOnCanvas.x;
  // me.goalY = myPosOnCanvas.y;
  me.recalculatePosition();
  for (o of others) {
    // let pos = myMap.latLngToPixel(currentLatitude, currentLongitude)
    // o.update();
    o.recalculatePosition();
  }
}

class Person {
  constructor(id) {
    this.x = 0;
    this.y = 0;
    this.goalX = 0;
    this.goalY = 0;
    this.lat = 0;
    this.lon = 0;
    this.size = 14;
    this.col = color(170, 240, 190);
    this.id = id;
  }
  recalculatePosition() {
    if (mapInit) {
      let pos = myMap.latLngToPixel(this.lat, this.lon);
      this.goalX = pos.x;
      this.goalY = pos.y;
    }
  }
  update() {
    // lerp to each new location to keep things smoother
    this.x = lerp(this.x, this.goalX, 0.2);
    this.y = lerp(this.y, this.goalY, 0.2);
  }
  display() {
    push();
    translate(this.x, this.y);
    fill(this.col);
    stroke("pink");
    strokeWeight(3);
    let dia = this.size + sin(frameCount * 0.1);
    circle(0, 0, dia);
    noStroke();
    fill(0);
    text(this.id, 0, 0);

    pop();
  }
}
