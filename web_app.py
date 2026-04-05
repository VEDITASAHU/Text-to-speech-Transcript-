import os
from flask import Flask, request, jsonify, render_template
import speech_recognition as sr
import tempfile

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/transcribe', methods=['POST'])
def transcribe():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file found in request'}), 400
        
    audio_file = request.files['audio']
    
    # Save the uploaded file to a temporary location
    try:
        tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        audio_file.save(tmp_file.name)
        
        # Transcribe using SpeechRecognition
        r = sr.Recognizer()
        with sr.AudioFile(tmp_file.name) as source:
            audio_data = r.record(source)
            text = r.recognize_google(audio_data)
            
        return jsonify({'success': True, 'text': text})
        
    except sr.UnknownValueError:
        return jsonify({'success': False, 'error': 'Could not understand the audio. Please speak clearly.'})
    except sr.RequestError as e:
        return jsonify({'success': False, 'error': f'Speech service error: {e}'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})
    finally:
        # Cleanup
        if 'tmp_file' in locals():
            os.remove(tmp_file.name)

if __name__ == '__main__':
    print("Starting server... open http://127.0.0.1:5000 in your browser.")
    app.run(debug=True, port=5000)
