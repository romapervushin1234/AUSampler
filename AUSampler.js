/**
 * Microtonal Audio Sampler
 * A p5.js-based application that allows loading and playing custom musical scales
 * and audio samples with microtonal tuning capabilities.
 */

// Core audio and scale state
let sound;                  // Main p5.js sound object
let soundPlayers = {};      // Pitched versions of the sound for each note
let isPlaying = {};         // Tracks which notes are currently playing
let sampleLoaded = false;   // Flag indicating if an audio sample is loaded
let scaleLoaded = false;    // Flag indicating if a scale file is loaded
let pressedKeys = new Set(); // Tracks currently pressed keys

// Musical parameters
let scaleRatios = [];      // Array of frequency ratios from the loaded scale
let baseNote = 60;         // MIDI note number for middle C (60)
let baseFreq = 111;     // Frequency of middle C in Hz
let currentOctave = 3;     // Starting octave

// UI Constants
const KEY_WIDTH = 40;      // Width of piano keys in pixels
const KEY_HEIGHT = 150;    // Height of piano keys in pixels
const BLACK_KEY_WIDTH_RATIO = 0.6;   // Black keys are 60% as wide as white keys
const BLACK_KEY_HEIGHT_RATIO = 0.6;  // Black keys are 60% as tall as white keys

// Piano key mappings
const WHITE_KEY_OFFSETS = [0, 2, 4, 5, 7, 9, 11];  // Semitone offsets for white keys
const BLACK_KEY_OFFSETS = [1, 3, null, 6, 8, 10, null];  // Semitone offsets for black keys

// Keyboard to MIDI note mapping
const KEYBOARD_MAP = {
    'a': 60, // Middle C
    'w': 61,
    's': 62,
    'e': 63,
    'd': 64,
    'f': 65,
    't': 66,
    'g': 67,
    'y': 68,
    'h': 69,
    'u': 70,
    'j': 71,
    'k': 72  // Next C
};

/**
 * p5.js setup function - initializes the application
 */
function setup() {
    createCanvas(800, 600);
    createUI();
    initializeDefaultScale();
}

/**
 * Creates the file input UI elements
 */
function createUI() {
    const container = createDiv('');
    container.position(10, 10);
    container.style('display', 'flex');
    container.style('flex-direction', 'column');
    container.style('gap', '10px');

    // Create file inputs for scale and audio files
    const sclInput = createFileInput(handleSclFile);
    const audioInput = createFileInput(handleAudioFile);

    [sclInput, audioInput].forEach(input => {
        input.parent(container);
        input.style('margin', '5px');
    });
}

/**
 * Initializes the default 12-tone equal temperament scale
 */
function initializeDefaultScale() {
    scaleRatios = [1];  // Start with unison
    for (let i = 1; i < 12; i++) {
        scaleRatios.push(Math.pow(2, i/12));
    }
    scaleRatios.push(2);  // Add octave
    scaleLoaded = true;
}

/**
 * Handles loading and parsing of .scl (Scala) scale files
 * @param {File} file - The uploaded .scl file
 */
function handleSclFile(file) {
    // Check if the file has a .scl extension
    if (!file.name.endsWith('.scl')) {
        console.log('Invalid file type - expected .scl file');
        return;
    }

    // Reset the scale state
    scaleRatios = [];

    // Read the file data
    const reader = new FileReader();
    reader.onload = function(event) {
        const fileContent = event.target.result;
        const lines = fileContent.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('!'));

        console.log('Filtered lines:', lines);

        if (lines.length < 2) {
            console.error('Invalid scale file format');
            return;
        }

        const description = lines[0];
        const numNotes = parseInt(lines[1]);

        if (isNaN(numNotes) || numNotes <= 0) {
            console.error('Invalid number of notes in scale file');
            return;
        }

        // Always start with unison
        scaleRatios.push(1);

        // Parse each ratio line, starting from line 2
        for (let i = 2; i < lines.length; i++) {
            const ratio = parseScalaRatio(lines[i]);
            if (ratio !== null) {
                scaleRatios.push(ratio);
            }
        }

        // Validate that we got the expected number of ratios
        if (scaleRatios.length !== numNotes + 1) { // +1 for the unison
            console.warn(`Expected ${numNotes} ratios but found ${scaleRatios.length - 1}`);
        }

        // Ensure scale ends with octave if it doesn't already
        if (scaleRatios[scaleRatios.length - 1] !== 2) {
            scaleRatios.push(2);
        }

        if (scaleRatios.length > 1) {
            scaleLoaded = true;
            console.log(`Loaded scale: ${description}`);
            console.log(`Ratios: ${scaleRatios.map(r => r.toFixed(3)).join(', ')}`);

            // Important: Recreate the pitched samples with new ratios
            if (sampleLoaded) {
                createPitchedSamples();
            }

            // Force a redraw to update the piano display
            redraw();
        } else {
            console.error('No valid ratios found in scale file');
            initializeDefaultScale();
        }
    };

    reader.readAsText(file.file);
}

/**
 * Parses a single line from a Scala file into a frequency ratio
 * @param {string} line - A line from the Scala file
 * @returns {number|null} - The parsed ratio or null if invalid
 */
function parseScalaRatio(line) {
    // Remove any comments from the line
    line = line.split('!')[0].trim();

    if (!line) return null;

    if (line.includes('/')) {
        // Handle ratio format (e.g., "3/2")
        const [num, denom] = line.split('/').map(x => parseFloat(x.trim()));
        if (!isNaN(num) && !isNaN(denom) && denom !== 0) {
            return num / denom;
        }
    } else {
        // Handle cents format (e.g., "701.955")
        const cents = parseFloat(line);
        if (!isNaN(cents)) {
            return Math.pow(2, cents / 1200);
        }
    }

    console.warn(`Failed to parse scale line: ${line}`);
    return null;
}

/**
 * Handles loading of audio sample files
 * @param {File} file - The uploaded audio file
 */
function handleAudioFile(file) {
    if (file.type.startsWith('audio')) {
        loadSound(file.data, loaded => {
            sound = loaded;
            sampleLoaded = true;
            console.log('Audio sample loaded');
            createPitchedSamples();
        });
    }
}

/**
 * Creates pitched versions of the loaded sample for each note in the scale
 */
function createPitchedSamples() {
    if (!sound || !scaleLoaded) {
        console.log('Cannot create pitched samples - missing sound or scale');
        return;
    }

    // Clear existing sound players
    soundPlayers = {};

    // Create pitched versions for two octaves
    for (let octave = 0; octave < 2; octave++) {
        for (let i = 0; i < scaleRatios.length; i++) {
            const noteNumber = baseNote + (octave * scaleRatios.length) + i;
            const ratio = calculatePitchRatio(noteNumber);

            // Create a new copy of the sound with the calculated ratio
            soundPlayers[noteNumber] = sound.rate(ratio);
        }
    }

    console.log(`Created ${Object.keys(soundPlayers).length} pitched samples`);
}

/**
 * Calculates the pitch ratio for a given MIDI note number
 * @param {number} midiNote - MIDI note number
 * @returns {number} - Frequency ratio relative to base note
 */
function calculatePitchRatio(midiNote) {
    const steps = midiNote - baseNote;
    const octaves = Math.floor(steps / scaleRatios.length);
    const scaleIndex = mod(steps, scaleRatios.length);
    return scaleRatios[scaleIndex] * Math.pow(2, octaves);
}

/**
 * Plays a note at the specified MIDI note number
 * @param {number} midiNote - MIDI note number to play
 */
function playNote(midiNote) {
    if (!sampleLoaded) return;

    if (isPlaying[midiNote]) {
        stopNote(midiNote);
    }

    const ratio = calculatePitchRatio(midiNote);
    sound.rate(ratio);
    sound.play();
    isPlaying[midiNote] = true;
}

/**
 * Stops playback of a specific note
 * @param {number} midiNote - MIDI note number to stop
 */
function stopNote(midiNote) {
    if (isPlaying[midiNote]) {
        sound.stop();
        isPlaying[midiNote] = false;
    }
}

/**
 * p5.js draw function - renders the piano keyboard and info display
 */
function draw() {
    background(240);
    drawPiano();
    displayInfo();
}

/**
 * Draws the piano keyboard interface
 */
function drawPiano() {
    // Draw two octaves
    for (let octave = 0; octave < 2; octave++) {
        // Draw white keys
        for (let i = 0; i < 7; i++) {
            const x = i * KEY_WIDTH + (octave * 7 * KEY_WIDTH);
            const y = 200;
            const noteNumber = baseNote + (octave * 12) + WHITE_KEY_OFFSETS[i];

            fill(pressedKeys.has(noteNumber) ? color(200, 200, 255) : 255);
            stroke(0);
            rect(x, y, KEY_WIDTH, KEY_HEIGHT);

            // Draw note info
            if (scaleLoaded) {
                drawNoteInfo(x, y, noteNumber);
            }
        }

        // Draw black keys
        for (let i = 0; i < 7; i++) {
            if (BLACK_KEY_OFFSETS[i] !== null) {
                const x = i * KEY_WIDTH + KEY_WIDTH * 0.7 + (octave * 7 * KEY_WIDTH);
                const y = 200;
                const noteNumber = baseNote + (octave * 12) + BLACK_KEY_OFFSETS[i];

                fill(pressedKeys.has(noteNumber) ? color(150, 150, 200) : 0);
                stroke(0);
                rect(x, y, KEY_WIDTH * BLACK_KEY_WIDTH_RATIO, KEY_HEIGHT * BLACK_KEY_HEIGHT_RATIO);
            }
        }
    }
}

/**
 * Draws frequency ratio and cents information for a note
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} noteNumber - MIDI note number
 */
function drawNoteInfo(x, y, noteNumber) {
    const ratio = calculatePitchRatio(noteNumber);
    const cents = Math.log2(ratio) * 1200;

    fill(0);
    textSize(10);
    textAlign(CENTER);
    text(`${ratio.toFixed(3)}`, x + KEY_WIDTH/2, y + KEY_HEIGHT - 30);
    text(`${cents.toFixed(1)}¢`, x + KEY_WIDTH/2, y + KEY_HEIGHT - 15);
}

/**
 * Displays current scale and sample status
 */
function displayInfo() {
    push();
    fill(0);
    textSize(14);
    textAlign(LEFT);

    const y = height - 100;

    text(`Scale status: ${scaleLoaded ? 
        `Loaded with ${scaleRatios.length} notes` : 
        'No scale loaded. Using 12-TET'}`, 
        10, y);

    text(`Sample status: ${sampleLoaded ? 
        'Loaded and ready' : 
        'No sample loaded'}`, 
        10, y + 20);

    if (scaleLoaded) {
        text('First few ratios: ' + 
            scaleRatios.slice(0,5)
                .map(r => r.toFixed(3))
                .join(', ') + '...', 
            10, y + 40);
    }
    pop();
}

/**
 * Proper modulo operation that works with negative numbers
 */
function mod(n, m) {
    return ((n % m) + m) % m;
}

// Event Handlers
function keyPressed() {
    const note = KEYBOARD_MAP[key.toLowerCase()];
    if (note !== null) {
        pressedKeys.add(note);
        playNote(note);
    }
}

function keyReleased() {
    const note = KEYBOARD_MAP[key.toLowerCase()];
    if (note !== null) {
        pressedKeys.delete(note);
        stopNote(note);
    }
}

function mousePressed() {
    handlePianoClick();
}

function mouseReleased() {
    pressedKeys.clear();
    Object.keys(isPlaying).forEach(stopNote);
}

/**
 * Handles mouse clicks on the piano keyboard
 */
function handlePianoClick() {
    if (mouseY < 200 || mouseY > 200 + KEY_HEIGHT) return;

    const x = mouseX;
    const octave = floor(x / (7 * KEY_WIDTH));
    const remainder = x % (7 * KEY_WIDTH);

    // Check black keys first (they're on top)
    const blackKeyIndex = floor((remainder - KEY_WIDTH * 0.7) / KEY_WIDTH);
    if (mouseY <= 200 + KEY_HEIGHT * BLACK_KEY_HEIGHT_RATIO && 
        remainder >= KEY_WIDTH * 0.7 && 
        blackKeyIndex >= 0 && 
        blackKeyIndex < 7 &&
        BLACK_KEY_OFFSETS[blackKeyIndex] !== null) {

        const note = baseNote + (octave * 12) + BLACK_KEY_OFFSETS[blackKeyIndex];
        pressedKeys.add(note);
        playNote(note);
        return;
    }

    // Check white keys
    const whiteKeyIndex = floor(remainder / KEY_WIDTH);
    if (whiteKeyIndex >= 0 && whiteKeyIndex < 7) {
        const note = baseNote + (octave * 12) + WHITE_KEY_OFFSETS[whiteKeyIndex];
        pressedKeys.add(note);
        playNote(note);
    }
}
