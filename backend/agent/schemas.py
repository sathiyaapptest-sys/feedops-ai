from typing import List, Optional
from pydantic import BaseModel, Field

class PostalAddress(BaseModel):
    streetAddress: str
    addressLocality: str
    addressRegion: str
    postalCode: str
    addressCountry: str

class Entity(BaseModel):
    """Schema for a Merchant Entity in Google Actions Center."""
    type: str = Field(default="Restaurant", alias="@type")
    id: str = Field(alias="@id")
    name: str
    address: PostalAddress
    telephone: Optional[str] = None
    url: Optional[str] = None

class ActionLink(BaseModel):
    url: str
    actionPlatform: List[str]

class Action(BaseModel):
    """Schema for an Action in Google Actions Center."""
    type: str = Field(default="OrderAction", alias="@type")
    id: str = Field(alias="@id")
    actionType: str
    actionLink: ActionLink

class Service(BaseModel):
    """Schema for a Service in Google Actions Center."""
    type: str = Field(default="Service", alias="@type")
    id: str = Field(alias="@id")
    provider: str
    action: Action
