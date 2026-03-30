let mappa = new Mappa("Leaflet"); // map library
let myMap;
let canvas;
let currentLongitude = 0; // global variables will be updated as we get GPS data
let currentLatitude = 0; // global variables will be updated as we get GPS data
let mapInit = false; // we only do map stuff once mapInit is true (see in draw)
let me; // point object showing our own location

// options for map
// we only actually initialize the map once we get gps data (in draw)
// there are different suppliers and styles of maps available
// these are some chinese ones I found
let mappa_options = {
  lat: 0, // will change once we have data
  lng: 0, // will change once we have data
  zoom: 16, // initial zoom level
  // style: "https://b.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
  style:
    "https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}",
  // style:
  // "https://webst01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=6&x={x}&y={y}&z={z}",
};

function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");
  me = new MyPoint();
}

function draw() {
  clear();

  // Initialize full screen map (from https://mappa.js.org)
  if (!mapInit && GPS_GRANTED && currentLongitude != 0) {
    console.log("starting map");
    mappa_options.lat = currentLatitude;
    mappa_options.lng = currentLongitude;
    myMap = mappa.tileMap(mappa_options);
    myMap.overlay(canvas);
    myMap.onChange(updateMapContent); // important to update our drawings on the map
    mapInit = true; // this if statement sould run only once
  }

  if (mapInit) {
    // only update and draw our point if we actually have data
    me.update();
    me.display();
    // console.log(me)
  }
}

// P5 touch events: https://p5js.org/reference/#Touch
function touchStarted() {
  if (mapInit) {
    // the touches array registers which pixel of the canvas we touch
    // using the pixelToLatLng function, we can translate from pixel
    // to coordination system
    let pos = myMap.pixelToLatLng(touches[0].x, touches[0].y);
    console.log("TOUCHED", pos);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function handleNewPosition(pos) {
  console.log("NEW LOC", pos);

  console.log("accuracy:", pos.coords.accuracy, "meters");
  me.accuracy = pos.coords.accuracy;

  // fix location for chinese map tiles (function in requestGPS.js)
  let lonlat = fixForChineseMap(pos);
  currentLongitude = lonlat[0];
  currentLatitude = lonlat[1];
  console.log(currentLatitude, currentLongitude);

  if (mapInit) {
    // if map already displayed, update the point
    updateMapContent();
  }
}

function updateMapContent() {
  let myPosOnCanvas = myMap.latLngToPixel(currentLatitude, currentLongitude)
  me.goalX = myPosOnCanvas.x;
  me.goalY = myPosOnCanvas.y;
}

function metersToPixel(meters, lat) {
  z = myMap.zoom();
  const mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z); // meters/pixel
  return meters / mpp;
}

class MyPoint {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.goalX = 0;
    this.goalY = 0;
    this.size = 14;
    this.col = color(170, 240, 190);
    this.accuracy = 0;
  }
  update() {
    // lerp to each new location to keep things smoother
    this.x = lerp(this.x, this.goalX, 0.2);
    this.y = lerp(this.y, this.goalY, 0.2);
  }
  display() {
    push();
    translate(this.x, this.y);

    //accuracy
    noFill();
    stroke("red");
    let diameter = 2 * metersToPixel(this.accuracy, currentLatitude);
    circle(0, 0, diameter);
    line(0, 0, diameter / 2, 0);
    fill("red");
    noStroke();
    if (mapInit) {
      textSize(map(myMap.zoom(), 9, 18, 0, 12));
    }
    // console.log(12*(myMap.getZoom()/18))
    text("accuracy:" + this.accuracy, diameter / 2 + 1, 0);

    fill(this.col);
    stroke("pink");
    strokeWeight(3);
    let dia = this.size + sin(frameCount * 0.1);
    circle(0, 0, dia);

    pop();
  }
}
