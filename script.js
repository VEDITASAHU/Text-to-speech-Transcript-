document.addEventListener('DOMContentLoaded', () => {
    const recordBtn = document.getElementById('record-btn');
    const recordBtnText = document.getElementById('record-btn-text');
    const recordIcon = recordBtn.querySelector('i');
    
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const visualizer = document.getElementById('visualizer-container');
    
    const outputContainer = document.getElementById('output-container');
    const outputBox = document.getElementById('transcription-output');
    const loader = document.getElementById('loader');
    const errorBox = document.getElementById('error-box');

    let audioContext;
    let processor;
    let input;
    let globalStream;
    let isRecording = false;
    
    // We will collect raw PCM data to manually encode into WAV
    // because SpeechRecognition python lib specifically requires WAV/AIFF/FLAC
    // and MediaRecorder outputs WebM/OGG on most browsers.
    let leftchannel = [];
    let rightchannel = [];
    let recordingLength = 0;
    let sampleRate = 44100;

    recordBtn.addEventListener('click', () => {
        if (!isRecording) {
            startRecording();
        } else {
            stopRecording();
        }
    });

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            globalStream = stream;
            
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            sampleRate = audioContext.sampleRate;
            
            // Create AudioNodes
            input = audioContext.createMediaStreamSource(stream);
            processor = audioContext.createScriptProcessor(4096, 2, 2);
            
            input.connect(processor);
            processor.connect(audioContext.destination);

            // Reset arrays
            leftchannel = [];
            rightchannel = [];
            recordingLength = 0;

            processor.onaudioprocess = function(e) {
                if (!isRecording) return;
                const left = e.inputBuffer.getChannelData(0);
                const right = e.inputBuffer.getChannelData(1);
                // clone the arrays
                leftchannel.push(new Float32Array(left));
                rightchannel.push(new Float32Array(right));
                recordingLength += 4096;
            };

            isRecording = true;
            updateUIState('recording');
            
        } catch (err) {
            console.error(err);
            showError("Could not access microphone! " + err.message);
        }
    }

    function stopRecording() {
        isRecording = false;
        
        if (processor && input) {
            processor.disconnect();
            input.disconnect();
        }
        if (globalStream) {
            globalStream.getTracks().forEach(track => track.stop());
        }

        updateUIState('processing');

        // Package the PCM data into WAV
        const wavBlob = createWavBlob();
        sendAudioToServer(wavBlob);
    }

    function updateUIState(state) {
        errorBox.textContent = "";
        
        if (state === 'recording') {
            recordBtn.classList.add('is-recording');
            recordIcon.className = "fa-solid fa-stop";
            recordBtnText.textContent = "Stop Recording";
            
            statusDot.classList.add('recording');
            statusText.textContent = "Listening...";
            statusText.style.color = "var(--accent-error)";
            
            visualizer.classList.add('active');
            outputContainer.style.display = 'none';
        } 
        else if (state === 'processing') {
            recordBtn.classList.remove('is-recording');
            recordIcon.className = "fa-solid fa-microphone";
            recordBtnText.textContent = "Start Recording";
            recordBtn.disabled = true; // Disable until done
            recordBtn.style.opacity = '0.5';
            
            statusDot.classList.remove('recording');
            statusText.textContent = "Processing...";
            statusText.style.color = "var(--text-main)";
            
            visualizer.classList.remove('active');
            loader.style.display = 'flex';
        }
        else if (state === 'ready') {
            recordBtn.disabled = false;
            recordBtn.style.opacity = '1';
            
            statusText.textContent = "Ready to Record";
            loader.style.display = 'none';
        }
    }

    async function sendAudioToServer(blob) {
        const formData = new FormData();
        formData.append('audio', blob, 'recording.wav');

        try {
            const response = await fetch('/api/transcribe', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            updateUIState('ready');
            
            if (result.success) {
                showResult(result.text);
            } else {
                showError(result.error || "Unknown error occurred server-side.");
            }
        } catch (err) {
            console.error(err);
            updateUIState('ready');
            showError("Failed to communicate with the server.");
        }
    }

    function showResult(text) {
        outputContainer.style.display = 'block';
        outputBox.innerHTML = `<p>${text}</p>`;
    }

    function showError(msg) {
        errorBox.textContent = msg;
        outputContainer.style.display = 'none';
    }

    // --- Audio Encoding Utils (PCM to WAV) ---
    function mergeBuffers(channelBuffer, recordingLength) {
        let result = new Float32Array(recordingLength);
        let offset = 0;
        for (let i = 0; i < channelBuffer.length; i++) {
            result.set(channelBuffer[i], offset);
            offset += channelBuffer[i].length;
        }
        return result;
    }

    function interleave(leftChannel, rightChannel) {
        let length = leftChannel.length + rightChannel.length;
        let result = new Float32Array(length);
        let inputIndex = 0;
        for (let index = 0; index < length;) {
            result[index++] = leftChannel[inputIndex];
            result[index++] = rightChannel[inputIndex];
            inputIndex++;
        }
        return result;
    }

    function writeUTFBytes(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    function createWavBlob() {
        const interleaved = interleave(
            mergeBuffers(leftchannel, recordingLength),
            mergeBuffers(rightchannel, recordingLength)
        );

        // create the buffer and view to create the .WAV file
        const buffer = new ArrayBuffer(44 + interleaved.length * 2);
        const view = new DataView(buffer);

        // RIFF header
        writeUTFBytes(view, 0, 'RIFF');
        view.setUint32(4, 36 + interleaved.length * 2, true);
        writeUTFBytes(view, 8, 'WAVE');
        // FMT sub-chunk
        writeUTFBytes(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        // stereo (2 channels)
        view.setUint16(22, 2, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 4, true);
        view.setUint16(32, 4, true);
        view.setUint16(34, 16, true);
        // data sub-chunk
        writeUTFBytes(view, 36, 'data');
        view.setUint32(40, interleaved.length * 2, true);

        // write the PCM samples
        let lng = interleaved.length;
        let index = 44;
        let volume = 1;
        for (let i = 0; i < lng; i++) {
            view.setInt16(index, interleaved[i] * (0x7FFF * volume), true);
            index += 2;
        }

        return new Blob([view], { type: 'audio/wav' });
    }
});
