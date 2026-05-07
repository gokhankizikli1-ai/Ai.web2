# coding: utf-8
from ai_client import ask_ai
from prompts import FINANCE_SYSTEM, FINANCE_TEMPLATE




async def run_finance_analysis(user_message, symbol, depth_label, tool_context, mem_summary="", style_prompt="", use_gpt4=False, model=None):
    system = FINANCE_SYSTEM
    if mem_summary:
        system += "\n\nUser memory:\n" + mem_summary
    if style_prompt:
        system += "\n\n" + style_prompt
    prompt = FINANCE_TEMPLATE.format(
        question=user_message,
        symbol=symbol,
        depth=depth_label,
        context=tool_context,
    )
    return await ask_ai(prompt, system, use_gpt4=use_gpt4, model=model)
