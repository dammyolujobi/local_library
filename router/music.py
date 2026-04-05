from fastapi import APIRouter,Depends
import fitz
from ollama import Client
import os
from utils.mongosetup import db
from fastapi.responses import JSONResponse, FileResponse
from dotenv import load_dotenv

load_dotenv()
router = APIRouter(
    tags=["Music"]
)

client = Client(
    host="https://ollama.com",
    headers={'Authorization': 'Bearer ' + os.getenv('OLLAMA_API_KEY')}
)

@router.get("/get_pdf_content")
async def get_pdf_content(file_path:str):
    full_text = ""
    doc = fitz.open(file_path)
    for page in doc:
        full_text += page.get_text()
    
    return full_text


def model_classify(metadata: str = Depends(get_pdf_content)):
    
    messages = [
        {
            "role": "user",
            "content":f"""
                You are a book genre classifier. Given book metadata, return ONLY a single genre 
                word/phrase from this exact list:

                FICTION: horror, romance, adventure, mystery, fantasy, science fiction, thriller, 
                crime, dystopian, historical fiction, literary fiction, western, mythology, 
                war fiction, gothic, comedy, drama

                NON-FICTION / ACADEMIC: computer science, programming, mathematics, engineering, 
                physics, biology, chemistry, medicine, self-help, biography, history, philosophy, 
                psychology, business, economics, politics, science, travel, religion, true crime, 
                memoir, art, cooking, sports

                CHILDREN / YA: children, young adult, fairy tale


                Metadata: {metadata}

                Reply with only the genre, nothing else.
                """
                        },
                    ]

    # Collect streamed chunks into one string
    genre = ""
    for part in client.chat("minimax-m2:cloud", messages=messages, stream=True):
        genre += part["message"]["content"]

    genre = genre.strip().lower()
    return genre

@router.get("/get-music-files")
async def get_music_files(genre: str):
    """Get music files for a genre"""
    try:
        music_config = db["music_config"]
        config = music_config.find_one({"genre": genre})
        
        folder_path = ""
        music_files = []
        
        if config and config.get("folder"):
            folder_path = config["folder"]
            
            if os.path.exists(folder_path):
                for file in os.listdir(folder_path):
                    if file.lower().endswith(('.mp3', '.wav', '.flac', '.ogg', '.m4a')):
                        music_files.append({
                            "name": file,
                            "path": os.path.join(folder_path, file)
                        })
        
        return {"files": music_files, "genre": genre, "folder": folder_path}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

@router.post("/set-music-folder")
async def set_music_folder(data: dict):
    """Set music folder for a genre"""
    try:
        genre = data.get("genre", "")
        folder_path = data.get("folder", "")
        
        if not genre or not folder_path:
            return JSONResponse({"error": "Genre and folder required"}, status_code=400)
        
        if not os.path.exists(folder_path):
            return JSONResponse({"error": "Folder does not exist"}, status_code=400)
        
        music_config = db["music_config"]
        music_config.update_one(
            {"genre": genre},
            {"$set": {"folder": folder_path}},
            upsert=True
        )
        
        return {"status": "ok", "message": f"Music folder set for {genre}"}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

@router.get("/music-file")
async def get_music_file(path: str):
    """Serve music file"""
    if path and os.path.exists(path):
        return FileResponse(path, media_type="audio/mpeg")
    return JSONResponse({"error": "File not found"}, status_code=404)
