const Tuner = function (a4) {
  this.middleA = a4 || 440
  this.semitone = 69
  this.bufferSize = 4096
  this.noteStrings = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]

  this.initGetUserMedia()
}

Tuner.prototype.initGetUserMedia = function () {
  window.AudioContext = window.AudioContext || window.webkitAudioContext
  if (!window.AudioContext) {
    return alert("AudioContext not supported")
  }

  // Older browsers might not implement mediaDevices at all, so we set an empty object first
  if (navigator.mediaDevices === undefined) {
    navigator.mediaDevices = {}
  }

  // Some browsers partially implement mediaDevices. We can't just assign an object
  // with getUserMedia as it would overwrite existing properties.
  // Here, we will just add the getUserMedia property if it's missing.
  if (navigator.mediaDevices.getUserMedia === undefined) {
    navigator.mediaDevices.getUserMedia = function (constraints) {
      // First get ahold of the legacy getUserMedia, if present
      const getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia

      // Some browsers just don't implement it - return a rejected promise with an error
      // to keep a consistent interface
      if (!getUserMedia) {
        alert("getUserMedia is not implemented in this browser")
      }

      // Otherwise, wrap the call to the old navigator.getUserMedia with a Promise
      return new Promise(function (resolve, reject) {
        getUserMedia.call(navigator, constraints, resolve, reject)
      })
    }
  }
}

Tuner.prototype.startRecord = function () {
  const self = this
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then(function (stream) {
      self.audioContext.createMediaStreamSource(stream).connect(self.analyser)
      self.analyser.connect(self.scriptProcessor)
      self.scriptProcessor.connect(self.audioContext.destination)
      self.scriptProcessor.addEventListener("audioprocess", function (event) {
        const frequency = self.pitchDetector.do(event.inputBuffer.getChannelData(0))
        if (frequency && self.onNoteDetected) {
          const note = self.getNote(frequency)
          self.onNoteDetected({
            name: self.noteStrings[note % 12],
            value: note,
            cents: self.getCents(frequency, note),
            octave: parseInt(note / 12) - 1,
            frequency: frequency,
          })
        }
      })
    })
    .catch(function (error) {
      alert(error.name + ": " + error.message)
    })
}

Tuner.prototype.init = function () {
  this.audioContext = new window.AudioContext()
  this.analyser = this.audioContext.createAnalyser()
  this.scriptProcessor = this.audioContext.createScriptProcessor(this.bufferSize, 1, 1)

  const self = this

  aubio().then(function (aubio) {
    self.pitchDetector = new aubio.Pitch("default", self.bufferSize, 1, self.audioContext.sampleRate)
    self.startRecord()
  })
}

/**
 * get musical note from frequency
 *
 * @param {number} frequency
 * @returns {number}
 */
Tuner.prototype.getNote = function (frequency) {
  const note = 12 * (Math.log(frequency / this.middleA) / Math.log(2))
  return Math.round(note) + this.semitone
}

/**
 * get the musical note's standard frequency
 *
 * @param note
 * @returns {number}
 */
Tuner.prototype.getStandardFrequency = function (note) {
  return this.middleA * Math.pow(2, (note - this.semitone) / 12)
}

/**
 * get cents difference between given frequency and musical note's standard frequency
 *
 * @param {number} frequency
 * @param {number} note
 * @returns {number}
 */
Tuner.prototype.getCents = function (frequency, note) {
  return Math.floor((1200 * Math.log(frequency / this.getStandardFrequency(note))) / Math.log(2))
}

/**
 * play the musical note
 *
 * @param {number} frequency
 */
Tuner.prototype.play = function (frequency) {
  if (!this.oscillator) {
    this.oscillator = this.audioContext.createOscillator()
    this.oscillator.connect(this.audioContext.destination)
    this.oscillator.start()
  }
  this.oscillator.frequency.value = frequency
}

Tuner.prototype.stopOscillator = function () {
  if (this.oscillator) {
    this.oscillator.stop()
    this.oscillator = null
  }
}

/**
 * @param {string} selector
 * @constructor
 */
const Meter = function (selector) {
  this.$root = document.querySelector(selector)
  this.$pointer = this.$root.querySelector(".meter-pointer")
  this.init()
}

Meter.prototype.init = function () {
  for (var i = 0; i <= 10; i += 1) {
    const $scale = document.createElement("div")
    $scale.className = "meter-scale"
    $scale.style.transform = "rotate(" + (i * 9 - 45) + "deg)"
    if (i % 5 === 0) {
      $scale.classList.add("meter-scale-strong")
    }
    this.$root.appendChild($scale)
  }
}

/**
 * @param {number} deg
 */
Meter.prototype.update = function (deg) {
  this.$pointer.style.transform = "rotate(" + deg + "deg)"
}

const Notes = function (selector, tuner) {
  this.tuner = tuner
  this.isAutoMode = true
  this.$root = document.querySelector(selector)
  this.$notesList = this.$root.querySelector(".notes-list")
  this.$frequency = this.$root.querySelector(".frequency")
  this.$notes = []
  this.$notesMap = {}
  this.createNotes()
  this.$notesList.addEventListener("touchstart", (event) => event.stopPropagation())
}

Notes.prototype.createNotes = function () {
  this.$notesList.innerHTML = ""
  const minOctave = 1
  const maxOctave = 8
  for (var octave = minOctave; octave <= maxOctave; octave += 1) {
    for (var n = 0; n < 12; n += 1) {
      const $note = document.createElement("div")
      $note.className = "note"
      $note.dataset.name = this.tuner.noteStrings[n]
      $note.dataset.value = 12 * (octave + 1) + n
      $note.dataset.octave = octave.toString()
      $note.dataset.frequency = this.tuner.getStandardFrequency($note.dataset.value)
      $note.innerHTML =
        $note.dataset.name[0] +
        '<span class="note-sharp">' +
        ($note.dataset.name[1] || "") +
        "</span>" +
        '<span class="note-octave">' +
        $note.dataset.octave +
        "</span>"
      this.$notesList.appendChild($note)
      this.$notes.push($note)
      this.$notesMap[$note.dataset.value] = $note
    }
  }

  const self = this
  this.$notes.forEach(function ($note) {
    $note.addEventListener("click", function () {
      if (self.isAutoMode) {
        return
      }

      const $active = self.$notesList.querySelector(".active")
      if ($active === this) {
        self.tuner.stopOscillator()
        $active.classList.remove("active")
      } else {
        self.tuner.play(this.dataset.frequency)
        self.update($note.dataset)
      }
    })
  })
}

Notes.prototype.active = function ($note) {
  this.clearActive()
  $note.classList.add("active")
  this.$notesList.scrollLeft = $note.offsetLeft - (this.$notesList.clientWidth - $note.clientWidth) / 2
}

Notes.prototype.clearActive = function () {
  const $active = this.$notesList.querySelector(".active")
  if ($active) {
    $active.classList.remove("active")
  }
}

Notes.prototype.update = function (note) {
  if (note.value in this.$notesMap) {
    this.active(this.$notesMap[note.value])
    this.$frequency.childNodes[0].textContent = parseFloat(note.frequency).toFixed(1)
  }
}

Notes.prototype.toggleAutoMode = function () {
  if (!this.isAutoMode) {
    this.tuner.stopOscillator()
  }
  this.clearActive()
  this.isAutoMode = !this.isAutoMode
}

const Application = function () {
  this.initA4()
  this.tuner = new Tuner(this.a4)
  this.notes = new Notes(".notes", this.tuner)
  this.meter = new Meter(".meter")
  this.update({
    name: "A",
    frequency: this.a4,
    octave: 4,
    value: 69,
    cents: 0,
  })
}

Application.prototype.initA4 = function () {
  this.$a4 = document.querySelector(".a4 span")
  this.a4 = parseInt(localStorage.getItem("a4")) || 440
  this.$a4.innerHTML = this.a4
}

Application.prototype.start = function () {
  const self = this

  this.tuner.onNoteDetected = function (note) {
    if (self.notes.isAutoMode) {
      if (self.lastNote === note.name) {
        self.update(note)
      } else {
        self.lastNote = note.name
      }
    }
  }

  swal
    .fire({
        confirmButtonText: "Start",
        customClass: {
            popup: "swal-popup",
            confirmButton: "swal-confirm-button",
        }
    })
    .then(function () {
      self.tuner.init()
      self.frequencyData = new Uint8Array(self.tuner.analyser.frequencyBinCount)
    })

  this.$a4.addEventListener("click", function () {
    swal
      .fire({
        input: "number",
        inputValue: self.a4,
        customClass: {
            confirmButton: "swal-confirm-button",
        }
      })
      .then(function ({ value: a4 }) {
        if (!parseInt(a4) || a4 === self.a4) {
          return
        }
        self.a4 = a4
        self.$a4.innerHTML = a4
        self.tuner.middleA = a4
        self.notes.createNotes()
        self.update({
          name: "A",
          frequency: self.a4,
          octave: 4,
          value: 69,
          cents: 0,
        })
        localStorage.setItem("a4", a4)
      })
  })

  document.querySelector(".container input").addEventListener("change", () => {
    this.notes.toggleAutoMode()
  })
}

Application.prototype.update = function (note) {
  this.notes.update(note)
  this.meter.update((note.cents / 50) * 45)
}

const app = new Application()
app.start()
