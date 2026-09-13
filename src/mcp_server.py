"""Small JSON-RPC-shaped facade used by the lab agent."""
from __future__ import annotations
import json
from typing import Any, Dict, List
from tools import TOOLS_SCHEMA, dispatch_tool_call, validate_tool_arguments


class MCPHousingServer:
    def __init__(self, server_name: str = "student-housing-mcp-server") -> None:
        self.server_name, self.version = server_name, "1.0.0"

    def list_tools(self) -> List[Dict[str, Any]]:
        return TOOLS_SCHEMA

    def call_tool(self, tool_name: str, arguments: Dict[str, Any], execution_context: Dict[str, Any] | None = None) -> Dict[str, Any]:
        invalid = validate_tool_arguments(tool_name, arguments)
        if invalid:
            content = invalid
        else:
            try:
                content = json.loads(dispatch_tool_call(tool_name, arguments, execution_context))
            except (TypeError, json.JSONDecodeError):
                content = {"status": "ERROR", "error": {"code": "INTERNAL_ERROR", "message": "Tool trả dữ liệu không hợp lệ.", "retryable": False}}
        return {"jsonrpc": "2.0", "server": self.server_name, "tool": tool_name, "result": content}


MCPAcademicServer = MCPHousingServer

if __name__ == "__main__":
    server = MCPHousingServer()
    print(json.dumps({"server": server.server_name, "version": server.version, "tools": [x["name"] for x in server.list_tools()]}, ensure_ascii=False, indent=2))
