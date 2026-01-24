from pydantic import BaseModel
from typing import Optional, Literal

class PersonalityCreate(BaseModel):
    name: str
    prompt: str
    short_description: str
    tags: list[str]
    voice_id: str
    is_visible: bool = True

class PersonalityUpdate(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    short_description: Optional[str] = None
    tags: Optional[list[str]] = None
    voice_id: Optional[str] = None
    is_visible: Optional[bool] = None

class ConversationLog(BaseModel):
    role: Literal["user", "ai"]
    transcript: str
    session_id: Optional[str] = None


class ActiveUserState(BaseModel):
    user_id: Optional[str] = None


class AppModeState(BaseModel):
    mode: Optional[str] = None


class UserCreate(BaseModel):
    name: str
    age: Optional[int] = None
    dob: Optional[str] = None
    hobbies: list[str] = []
    personality_type: Optional[str] = None
    likes: list[str] = []
    current_personality_id: Optional[str] = None
    user_type: Optional[str] = "family"  # family | friend | guest
    device_volume: Optional[int] = 70

class UserUpdate(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = None
    dob: Optional[str] = None
    hobbies: Optional[list[str]] = None
    personality_type: Optional[str] = None
    likes: Optional[list[str]] = None
    current_personality_id: Optional[str] = None
    user_type: Optional[str] = None
    device_volume: Optional[int] = None

