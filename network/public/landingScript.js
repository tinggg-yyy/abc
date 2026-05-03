const usernameKEY = "user-nameTEST";

// Already have a name — skip straight to the map
if (localStorage.getItem(usernameKEY) != null) {
    window.location.href = "map.html";
}

let nameInputButton = document.querySelector("#submitNameButton");

function goToMap() {
    window.location.href = "map.html";
}

// Fake Keyboard
let nameValue = "";
let kbShift = false;

function updateNameDisplay() {
    document.getElementById("name-text").textContent = nameValue;
    nameInputButton.style.visibility = nameValue !== "" ? "visible" : "hidden";
}

document.querySelectorAll(".kb-key[data-char]").forEach(function (btn) {
    btn.addEventListener("click", function () {
        const char = kbShift ? btn.dataset.char.toUpperCase() : btn.dataset.char.toLowerCase();
        nameValue += char;
        updateNameDisplay();
        if (kbShift) {
            kbShift = false;
            document.getElementById("kb-shift-btn").classList.remove("active");
        }
    });
});

document.getElementById("kb-shift-btn").addEventListener("click", function () {
    kbShift = !kbShift;
    this.classList.toggle("active", kbShift);
});

document.getElementById("kb-backspace-btn").addEventListener("click", function () {
    nameValue = nameValue.slice(0, -1);
    updateNameDisplay();
});

document.getElementById("kb-space-btn").addEventListener("click", function () {
    nameValue += " ";
    updateNameDisplay();
});

document.getElementById("kb-enter-btn").addEventListener("click", submitName);
nameInputButton.addEventListener("click", submitName);

function submitName() {
    const name = nameValue.trim();
    if (!name) return;
    localStorage.setItem(usernameKEY, name);
    goToMap();
}
