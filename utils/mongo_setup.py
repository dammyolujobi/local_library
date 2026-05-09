from pymongo import MongoClient
from dotenv import load_dotenv
import os
load_dotenv()

MONGO_CONNECTION_STRING = os.getenv("MONGO_CONNECTION_STRING")

client = MongoClient(MONGO_CONNECTION_STRING)

db = client["local_library"]