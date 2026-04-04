from fastapi import APIRouter,Depends
import fitz
from ollama import Client
import os
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