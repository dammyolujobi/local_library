from pydantic import BaseModel

class Book(BaseModel):
    name:str
    path:str
    page:str
    song_assigned:str