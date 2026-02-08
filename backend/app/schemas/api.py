from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ChaosState(BaseModel):
    rotation: Optional[float] = None
    fontFamily: Optional[str] = None
    animation: Optional[str] = None
    theme: Optional[str] = None


class DashboardBlock(BaseModel):
    type: str
    props: Dict[str, Any] = Field(default_factory=dict)


class DashboardSpec(BaseModel):
    blocks: List[DashboardBlock] = Field(default_factory=list)
    chaos: Optional[ChaosState] = None


class QueryRequest(BaseModel):
    message: str
    currentChaos: Optional[Dict[str, Any]] = None
    userId: Optional[str] = None


class QueryResponse(BaseModel):
    dashboardSpec: DashboardSpec
    assistantMessage: str
    intent: str
    queryMetadata: Dict[str, Any] = Field(default_factory=dict)


class ChaosPreferenceRequest(BaseModel):
    userId: str
    chaos: Dict[str, Any]


class ChaosPreferenceResponse(BaseModel):
    userId: str
    chaos: Dict[str, Any]


class TTSRequest(BaseModel):
    text: str
