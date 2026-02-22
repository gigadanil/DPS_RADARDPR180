# 🔐 Полная инструкция: Telegram Auth + Supabase JWT

Эта инструкция описывает, как настроить безопасную авторизацию через Telegram Mini App с выдачей JWT токенов для работы с Supabase.

---

## 📋 Что будет работать после настройки

✅ Пользователи логинятся через Telegram (без пароля)  
✅ Edge Function проверяет подпись Telegram и выдает JWT токен  
✅ JWT используется для всех запросов к Supabase  
✅ RLS политики проверяют `auth.uid()` и ограничивают доступ  
✅ Пользователи могут менять/удалять только свои записи  
✅ Админ может удалять/менять любые записи  

---

## 🛠️ ЧАСТЬ 1: Настройка Supabase Auth

### Шаг 1.1: Включите JWT Custom Claims
1. Откройте **Supabase Dashboard** → ваш проект.
2. Перейдите в **Settings** → **API**.
3. Найдите раздел **JWT Settings**.
4. Запишите **JWT Secret** (понадобится для Edge Function).

### Шаг 1.2: Настройте переменные окружения для Edge Functions
1. Откройте **Edge Functions** в Dashboard.
2. Перейдите к функции `telegram-auth` (или создайте её позже).
3. Добавьте секреты (Secrets):
   - `TELEGRAM_BOT_TOKEN` — токен вашего Telegram бота
   - `JWT_SECRET` — JWT Secret из настроек API

**Где взять TELEGRAM_BOT_TOKEN:**
1. Откройте Telegram и найдите [@BotFather](https://t.me/BotFather).
2. Создайте бота командой `/newbot`.
3. Скопируйте токен (формат: `1234567890:AABBccDDeeFFggHHiiJJkkLLmmNNooP`)

---

## 🚀 ЧАСТЬ 2: Развертывание Edge Function

### Шаг 2.1: Проверьте структуру проекта
Убедитесь, что у вас есть файл `supabase/functions/telegram-auth/index.ts`:

```
📁 ваш-проект/
  📁 supabase/
    📁 functions/
      📁 telegram-auth/
        📄 index.ts
```

Если файла нет, используйте код из `supabase-cli/supabase/functions/telegram-auth/index.ts`.

### Шаг 2.2: Проверьте код Edge Function

Откройте `supabase/functions/telegram-auth/index.ts` и убедитесь, что:

```typescript
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const JWT_SECRET = Deno.env.get("JWT_SECRET") || "";
```

**ВАЖНО:** НЕ вставляйте токены прямо в код! Используйте переменные окружения.

### Шаг 2.3: Установите Supabase CLI (если ещё не сделали)

**Windows (PowerShell):**
```powershell
scoop install supabase
```

Или через npm:
```powershell
npm install -g supabase
```

### Шаг 2.4: Авторизуйтесь в Supabase
```powershell
supabase login
```

### Шаг 2.5: Привяжите проект
```powershell
supabase link --project-ref <YOUR_PROJECT_REF>
```

**Где взять PROJECT_REF:**  
Supabase Dashboard → Settings → General → Reference ID

### Шаг 2.6: Установите секреты
```powershell
supabase secrets set TELEGRAM_BOT_TOKEN=ваш_токен_бота
supabase secrets set JWT_SECRET=ваш_jwt_secret
```

### Шаг 2.7: Деплой функции
```powershell
supabase functions deploy telegram-auth
```

После успешного деплоя вы увидите URL функции:
```
https://ваш-проект.supabase.co/functions/v1/telegram-auth
```

---

## 💻 ЧАСТЬ 3: Настройка клиента (Mini App)

### Шаг 3.1: Инициализация Telegram WebApp

В вашем HTML/JavaScript добавьте скрипт Telegram:

```html
<script src="https://telegram.org/js/telegram-web-app.js"></script>
```

### Шаг 3.2: Получение JWT токена при старте приложения

```javascript
const SUPABASE_URL = 'https://ваш-проект.supabase.co';
const SUPABASE_ANON_KEY = 'ваш-anon-ключ';

// Инициализируем Supabase клиент
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function authenticateUser() {
    // Получаем initData от Telegram
    const initData = window.Telegram?.WebApp?.initData;
    
    if (!initData) {
        console.error('Нет данных от Telegram');
        return null;
    }

    // Проверяем кэш (токен действителен 1 час)
    const cachedToken = localStorage.getItem('sb_jwt');
    const cachedExp = Number(localStorage.getItem('sb_jwt_exp') || 0);
    const nowSec = Math.floor(Date.now() / 1000);
    
    if (cachedToken && cachedExp > nowSec + 60) {
        // Токен ещё валиден
        return cachedToken;
    }

    try {
        // Запрос к Edge Function
        const res = await fetch(`${SUPABASE_URL}/functions/v1/telegram-auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData })
        });

        if (!res.ok) {
            throw new Error('Ошибка авторизации');
        }

        const data = await res.json();
        
        // Сохраняем токен
        localStorage.setItem('sb_jwt', data.token);
        localStorage.setItem('sb_jwt_exp', String(data.exp));
        
        return data.token;
    } catch (error) {
        console.error('Ошибка при получении JWT:', error);
        return null;
    }
}

// Вызываем при загрузке приложения
authenticateUser().then(token => {
    if (token) {
        // Переключаем Supabase клиент на authenticated режим
        supabase.auth.setSession({
            access_token: token,
            refresh_token: ''
        });
        
        console.log('Авторизация успешна!');
    }
});
```

### Шаг 3.3: Использование JWT в запросах

После получения токена все запросы через Supabase клиент автоматически будут включать JWT:

```javascript
// Пример: создание метки
const { data, error } = await supabase
    .from('markers')
    .insert({
        author_id: userId,
        lat: 55.7558,
        lng: 37.6173,
        type: 'police',
        ts: Date.now()
    });

// RLS политика проверит, что author_id === auth.uid()
```

### Шаг 3.4: Ручная отправка JWT (если не используете Supabase клиент)

```javascript
const token = localStorage.getItem('sb_jwt');

fetch('https://ваш-проект.supabase.co/rest/v1/markers', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`  // ⬅️ JWT токен
    },
    body: JSON.stringify({
        author_id: userId,
        lat: 55.7558,
        lng: 37.6173
    })
});
```

---

## 🔒 ЧАСТЬ 4: Применение RLS политик

### Шаг 4.1: Запустите скрипт безопасности

1. Откройте **Supabase Dashboard** → **SQL Editor**.
2. Откройте файл `security_rls_own.sql` из вашего проекта.
3. Скопируйте содержимое и вставьте в SQL Editor.
4. Нажмите **Run**.

### Шаг 4.2: Проверьте, что RLS включен

```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('markers', 'messages', 'unban_requests', 'user_settings');
```

Все таблицы должны иметь `rowsecurity = true`.

### Шаг 4.3: Проверьте политики

```sql
SELECT schemaname, tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public' 
ORDER BY tablename, policyname;
```

Вы должны увидеть политики вида:
- `markers_select_all` — просмотр для всех
- `markers_delete_own` — удаление только своих
- `markers_delete_admin` — удаление для админа

---

## ✅ ЧАСТЬ 5: Проверка работы

### Тест 1: Проверка авторизации

Откройте консоль браузера в Mini App и выполните:

```javascript
console.log('Telegram User ID:', window.Telegram?.WebApp?.initDataUnsafe?.user?.id);
console.log('JWT Token:', localStorage.getItem('sb_jwt'));
```

Если оба значения есть — авторизация работает.

### Тест 2: Создание метки

```javascript
const userId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;

const { data, error } = await supabase
    .from('markers')
    .insert({
        author_id: String(userId),
        lat: 55.7558,
        lng: 37.6173,
        type: 'accident',
        ts: Date.now()
    });

console.log('Результат:', data, error);
```

Если `error = null` — метка создана успешно.

### Тест 3: Попытка удалить чужую метку

```javascript
// Попытка удалить метку другого пользователя
const { error } = await supabase
    .from('markers')
    .delete()
    .eq('id', 123);  // ID чужой метки

console.log('Ошибка (ожидается):', error);
// Должна быть ошибка: "new row violates row-level security policy"
```

### Тест 4: Удаление своей метки

```javascript
const userId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;

// Найдем свою метку
const { data: myMarkers } = await supabase
    .from('markers')
    .select('id')
    .eq('author_id', String(userId))
    .limit(1);

if (myMarkers && myMarkers.length > 0) {
    const { error } = await supabase
        .from('markers')
        .delete()
        .eq('id', myMarkers[0].id);
    
    console.log('Удаление своей метки:', error ? 'Ошибка' : 'Успешно');
}
```

---

## 🐛 Часто встречающиеся проблемы

### ❌ Ошибка: "Missing TELEGRAM_BOT_TOKEN or JWT_SECRET"

**Решение:**  
Секреты не установлены. Выполните:
```powershell
supabase secrets set TELEGRAM_BOT_TOKEN=ваш_токен
supabase secrets set JWT_SECRET=ваш_jwt_secret
```

### ❌ Ошибка: "Invalid hash"

**Причины:**
1. Неверный TELEGRAM_BOT_TOKEN
2. initData устарел (старше 24 часов)
3. initData был изменён

**Решение:**  
Проверьте правильность токена бота.

### ❌ Ошибка: "new row violates row-level security policy"

**Причина:**  
RLS политика блокирует операцию (это нормально, если вы пытаетесь изменить чужую запись).

**Решение:**  
Убедитесь, что `author_id` в запросе совпадает с вашим Telegram ID.

### ❌ Токен не работает / auth.uid() == null

**Причина:**  
JWT токен не передаётся в запросах или Supabase его не распознаёт.

**Решение:**
1. Проверьте, что JWT_SECRET в Edge Function совпадает с JWT Secret в Supabase.
2. Убедитесь, что токен передаётся в заголовке `Authorization: Bearer <token>`.
3. Проверьте срок действия токена (по умолчанию 1 час).

---

## 📊 Архитектура решения

```
┌─────────────────┐
│  Telegram User  │
└────────┬────────┘
         │ initData (подписано Telegram)
         ▼
┌─────────────────────────┐
│   Mini App (клиент)     │
│  final.html / JS        │
└────────┬────────────────┘
         │ POST /functions/v1/telegram-auth
         │ { initData }
         ▼
┌─────────────────────────┐
│  Edge Function          │
│  telegram-auth          │
│  ✓ Проверяет подпись    │
│  ✓ Выдает JWT токен     │
└────────┬────────────────┘
         │ { token, exp, user_id }
         ▼
┌─────────────────────────┐
│   Mini App              │
│  Сохраняет JWT          │
│  localStorage           │
└────────┬────────────────┘
         │ Supabase запросы с JWT
         │ Authorization: Bearer <token>
         ▼
┌─────────────────────────┐
│  Supabase Database      │
│  RLS политики:          │
│  ✓ auth.uid() проверка  │
│  ✓ is_admin() проверка  │
└─────────────────────────┘
```

---

## 🎯 Итоговый чеклист

- [ ] TELEGRAM_BOT_TOKEN получен от @BotFather
- [ ] JWT_SECRET взят из Supabase Dashboard
- [ ] Секреты установлены в Edge Function
- [ ] Edge Function `telegram-auth` задеплоена
- [ ] Клиент получает JWT при старте приложения
- [ ] JWT сохраняется в localStorage
- [ ] JWT передаётся во всех запросах к Supabase
- [ ] RLS политики применены (`security_rls_own.sql`)
- [ ] Функция `is_admin()` содержит правильный ID админа
- [ ] Тесты пройдены успешно

---

## 📚 Дополнительные ресурсы

- [Telegram Mini Apps Documentation](https://core.telegram.org/bots/webapps)
- [Supabase Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [JWT.io - Debugging JWT tokens](https://jwt.io/)

---

## 🆘 Поддержка

Если возникли проблемы:
1. Проверьте логи Edge Function в Supabase Dashboard → Edge Functions → telegram-auth → Logs
2. Проверьте консоль браузера на наличие ошибок
3. Убедитесь, что все секреты установлены корректно
4. Проверьте, что RLS политики применены

**Важно:** После любых изменений в Edge Function не забывайте делать `supabase functions deploy telegram-auth`.
