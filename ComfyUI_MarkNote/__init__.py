"""
ComfyUI-MarkNote
================
可安装的 ComfyUI 标注便签节点（Mark Note）。

安装：把整个 ComfyUI-MarkNote 文件夹放到 ComfyUI/custom_nodes/ 下，重启 ComfyUI。
使用：画布空白处右键 → Add Node → mark note → Mark Note。
"""

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]


class MarkNote:
    """纯 UI 标注节点：不参与数据流，内容随工作流一起保存。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {},
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ()
    FUNCTION = "run"
    CATEGORY = "mark note"
    OUTPUT_NODE = True
    DESCRIPTION = "富文本标注便签：字体/字号/颜色/加粗斜体/对齐/链接/分割线/图片/行删除/Mark 定格模式"

    def run(self, **kwargs):
        return ()


NODE_CLASS_MAPPINGS["MarkNote"] = MarkNote
NODE_DISPLAY_NAME_MAPPINGS["MarkNote"] = "Mark Note"
