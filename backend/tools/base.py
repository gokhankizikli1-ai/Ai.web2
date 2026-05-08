# coding: utf-8
from dataclasses import dataclass, field
from typing import Optional, Callable, Any


@dataclass
class VeloraTool:
    name: str
    description: str
    required_inputs: list
    safety_level: str       # "safe", "moderate", "sensitive"
    enabled: bool = False   # disabled until actually implemented
    handler: Optional[Callable] = field(default=None, repr=False)

    async def run(self, **kwargs) -> dict:
        if not self.enabled:
            return {
                "available": False,
                "message": "Bu arac henuz aktif degil. Velora yakinda ekleyecek.",
                "tool": self.name,
            }
        if self.handler is None:
            return {"available": False, "tool": self.name}
        try:
            return await self.handler(**kwargs)
        except Exception as e:
            return {"available": False, "error": str(e), "tool": self.name}
