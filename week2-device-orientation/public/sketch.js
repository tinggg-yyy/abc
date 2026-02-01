let alpha = 0,
  beta = 0,
  gamma = 0;
let ball;
let caves = [];
let goal;
let gameState = "start";
let sketchStarted = false;

function setup() {
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");

  textFont("Impact, Bold");

  // generate ball
  ball = new Ball(width / 2, height - 50, 20);

  // generate caves
  for (let i = 0; i < 7; i++) {
    caves.push(
      new Cave(
        random(50, width - 50),
        random(100, height - 150),
        random(40, 80),
      ),
    );
  }

  // generate goal
  goal = new Cave(width / 2, 40, 50);
}

function draw() {
  background(0);
  noStroke();

  for (let c of caves) {
    c.display();
  }

  goal.display();

  for (let i = 0; i < 5; i++) {
    // End point
    fill(255 - i * 30, 150 - i * 30, 0);
    circle(width / 2, 40, 70 - i * 10);
    // Start point
    fill(255 - i * 30, 150 - i * 30, 0);
    circle(width / 2, height - 50, 60 - i * 10);
  }

  if (gameState === "start") {
    ball.display();
    ball.update();
    ball.attractedTo(caves);
    ball.check(caves, goal);
  }

  // fill(255);
  // textSize(16);
  // text("alpha: " + round(alpha), 10, 30);
  // text("beta: " + round(beta), 10, 40);
  // text("gamma: " + round(gamma), 10, 50);

  if (gameState === "win") {
    textAlign(CENTER, CENTER);
    textSize(48);
    text("YOU WON!", width / 2, height / 2);
  }
}

// P5 touch events: https://p5js.org/reference/#Touch

function touchStarted() {
  console.log(touches);
}

function touchMoved() {}

function touchEnded() {}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function handleOrientation(eventData) {
  document.querySelector("#requestOrientationButton").style.display = "none";
  document.querySelector("h1").style.display = "none";
  document.getElementById("p5-container").style.display = "block";
  gameState = "start";

  //console.log(eventData.alpha, eventData.beta, eventData.gamma);
  console.log(gameState);

  alpha = eventData.alpha;
  beta = eventData.beta;
  gamma = eventData.gamma;
}

class Ball {
  constructor(x, y, r) {
    this.pos = createVector(x, y);
    this.r = r;
  }

  update() {
    this.pos.x += map(gamma, -90, 90, -10, 10);
    this.pos.y += map(beta, -180, 180, -10, 10);

    this.pos.x = constrain(this.pos.x, this.r, width - this.r);
    this.pos.y = constrain(this.pos.y, this.r, height - this.r);
  }

  check(cave, goal) {
    for (let c of caves) {
      let d = dist(this.pos.x, this.pos.y, c.pos.x, c.pos.y);
      if (d < 10) {
        // back to original position
        this.pos.x = width / 2;
        this.pos.y = height - 50;
        gameState = "lose";
      }
    }

    let dg = dist(this.pos.x, this.pos.y, goal.pos.x, goal.pos.y);
    if (dg < goal.r - this.r * 2) {
      gameState = "win";
      this.pos = goal.pos.copy();
      noLoop();
    }
  }

  attractedTo(cave) {
    for (let c of caves) {
      let d = dist(this.pos.x, this.pos.y, c.pos.x, c.pos.y);
      if (d < c.r) {
        let force = p5.Vector.sub(c.pos, this.pos);
        force.mult(0.05);
        this.pos.add(force);
      }
    }
  }

  display() {
    noStroke();
    for (let i = 0; i < 8; i++) {
      fill(50 + i * 27);
      circle(this.pos.x, this.pos.y, this.r * lerp(2, 0.8, i / 7));
    }
  }
}

class Cave {
  constructor(x, y, r) {
    this.pos = createVector(x, y);
    this.r = r;
  }

  display() {
    noStroke();
    for (let i = 0; i < 8; i++) {
      fill(200 - i * 30);
      circle(this.pos.x, this.pos.y, this.r * (1.2 - i * 0.1));
    }
  }
}
