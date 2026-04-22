#!/bin/bash
echo "🔄 جاري التحديث من GitHub..."
cd /root/g-sso
git pull origin main
echo "📦 تحديث الحزم..."
npm install
echo "✅ تم التحديث بنجاح!"