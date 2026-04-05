from fastapi import APIRouter,Depends
from fastapi.responses import JSONResponse, FileResponse
from utils.mongosetup import db
from pathlib import Path
from models.book import Book
import os
from router.music import model_classify

router = APIRouter(
    tags=["Library"]
)

collection = db["books"]
@router.get("/get_folder")
async def get_folder(folder_name:str):

    root_path = Path.home()
    path = f"{str(root_path)}\\{folder_name}"
    if os.path.exists(path) is True:
        return {"Message":"Path Exists","Folder":path}
    else:

        return JSONResponse({
            "content": "Path does not exist",
        },status_code=400)

@router.get("/get_files")
async def get_files(folder = Depends(get_folder)):
    files = []
    path = folder["Folder"]
    path = Path(path)

    for file in path.iterdir():
        if file.is_file() and file.suffix == ".pdf":
            files.append(file)
        
    if collection.count_documents({}) is None or collection.count_documents({}) < len(files):
        for file in files:
            if collection.find_one({"name":file.name}):
                continue
            else:
                genre = model_classify(str(file))
                book = {
                    "name":file.name,
                    "path":str(file),
                    "genre":genre
                }
                collection.insert_one(book)
        return files
    else:
        return files

@router.post("/search_files")
async def search_files(search:str,folder = Depends(get_folder)):
    found_files = []
    files = []

    path = folder["Folder"]
    path = Path(path)

    for file in path.iterdir():
        if file.is_file() and file.suffix == ".pdf":
            files.append(file)

    for i in range(0,len(files)):
        if search.lower() in str(files[i].name).lower():

            found_files.append(files[i])
        
    return found_files

@router.post("/open-file")
async def open_file(data: dict):
    path = data.get("path", "")
    if path and os.path.exists(path):
        os.startfile(path)
        return {"status": "ok"}
    return {"error": "File not found"}

@router.get("/pdf")
async def get_pdf(file_path: str):
    """Serve PDF file for frontend to load"""
    if file_path and os.path.exists(file_path):
        return FileResponse(file_path, media_type="application/pdf")
    return JSONResponse({"error": "File not found"}, status_code=404)

@router.post("/update-page")
async def update_page(data: dict):
    """Update current page in database"""
    try:
        file_path = data.get("path", "")
        page_num = data.get("page", 1)
        
        result = collection.update_one(
            {"path": file_path},
            {"$set": {"page": page_num}}
        )
        
        if result.matched_count > 0:
            return {"status": "ok", "message": "Page updated"}
        else:
            return JSONResponse({"error": "Book not found"}, status_code=404)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

@router.get("/get-page")
async def get_page(file_path: str):
    """Get last saved page for a book from database"""
    try:
        book = collection.find_one({"path": file_path})
        if book:
            return {"page": book.get("page", 1), "genre": book.get("genre", "unknown")}
        else:
            return JSONResponse({"error": "Book not found"}, status_code=404)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)




