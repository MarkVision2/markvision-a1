#!/bin/bash
# Получает актуальный курс USD/KZT

RATE=$(curl -s "https://api.exchangerate-api.com/v4/latest/USD" | \
  python3 -c "import json,sys; print(json.load(sys.stdin)['rates']['KZT'])" 2>/dev/null)

if [ -z "$RATE" ]; then
  echo "520"  # Fallback
else
  printf "%.2f" "$RATE"
fi
