# coding: utf-8
from ai_client import ask_ai
from prompts import DROP_SYSTEM, DROP_TEMPLATE




async def run_ecommerce_analysis(user_message, tool_context, mem_summary="", style_prompt="", use_gpt4=False, model=None):
    system = DROP_SYSTEM
    if mem_summary:
        system += "\n\nUser memory:\n" + mem_summary
    if style_prompt:
        system += "\n\n" + style_prompt
    prompt = DROP_TEMPLATE.format(question=user_message, context=tool_context)
    return await ask_ai(prompt, system, use_gpt4=use_gpt4, model=model)
