const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const axios = require('axios')

const BOT_NAME = "Redouane Ai"
const DEVELOPER = "رضوان المختطفي"

const keys = {
    GROQ: process.env.GROQ_API_KEY,
    HF: process.env.HF_TOKEN,
    GEMINI: process.env.GEMINI_API_KEY
}

const userMemory = {}

async function askGroq(userId, prompt, isImage = false) {
    const model = isImage? "llama-3.2-11b-vision-preview" : "llama-3.1-70b-versatile"
    if (!userMemory[userId]) {
        userMemory[userId] = [{
            role: "system",
            content: `سميتك ${BOT_NAME}. المطور ديالك هو ${DEVELOPER}. جاوب بالدارجة المغربية. كن ذكي ومفيد ومضحك شوية. إلا سولك شي واحد شكون صنعك قول ${DEVELOPER}.`
        }]
    }

    try {
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            messages: [...userMemory[userId],...prompt],
            model: model,
            temperature: 0.8,
            max_tokens: 1000
        }, { headers: { 'Authorization': `Bearer ${keys.GROQ}` } })
        return res.data.choices[0].message.content
    } catch {
        return `السيرفر عامر دابا أخويا، عاود جرب. ${BOT_NAME} خدام عليه ${DEVELOPER} 🛠️`
    }
}

async function genImageHF(prompt) {
    try {
        const res = await axios.post('https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0',
            { inputs: prompt },
            { headers: { 'Authorization': `Bearer ${keys.HF}` }, responseType: 'arraybuffer' }
        )
        return Buffer.from(res.data)
    } catch { return null }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth')
    const sock = makeWASocket({ auth: state, printQRInTerminal: true })

    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', (update) => {
        const { qr, connection } = update
        if(qr) {
            console.log(`سكاني هاد QR كود باش تربط ${BOT_NAME}:`)
            qrcode.generate(qr, {small: true})
        }
        if(connection === 'open') console.log(`${BOT_NAME} تربط مع واتساب ✅ | مطور بواسطة ${DEVELOPER}`)
    })

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0]
        if(!msg.message || msg.key.fromMe) return

        const sender = msg.key.remoteJid
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
        const cmd = text.split(' ')[0].toLowerCase()
        const args = text.slice(cmd.length).trim()

        try {
            if (cmd === '/start' || cmd === 'سلام') {
                await sock.sendMessage(sender, {
                    text: `مرحبا بك فـ *${BOT_NAME}* 🤖\nمطور بواسطة *${DEVELOPER}*\n\nشنو نقدر نعاونك؟\n\nالاوامر:\n/صورة وصف\n/حلل + تصويرة\n/كود بايثون\n/نكتة\n/صفر\n\nكتب /help للمزيد`
                })

            } else if (cmd === '/صورة') {
                await sock.sendMessage(sender, { text: `${BOT_NAME} كيصايب ليك التصويرة... ⏳` })
                const imgBuffer = await genImageHF(args)
                if(imgBuffer) await sock.sendMessage(sender, { image: imgBuffer, caption: `${args}\n\nصايبها ${BOT_NAME}` })
                else await sock.sendMessage(sender, { text: 'فشل التصويرة أخويا، جرب وصف آخر' })

            } else if (cmd === '/حلل' && msg.message.imageMessage) {
                const buffer = await downloadMediaMessage(msg, 'buffer', {})
                const base64 = buffer.toString('base64')
                const reply = await askGroq(sender, [{
                    role: "user", content: [
                        {type: "text", text: "شنو كاين فهاد التصويرة بالدارجة؟"},
                        {type: "image_url", image_url: {url: `data:image/jpeg;base64,${base64}`}}
                    ]
                }], true)
                await sock.sendMessage(sender, { text: reply || 'ما قدرتش نحلل أخويا' })

            } else if (cmd === '/كود') {
                const prompt = `كتب كود ${args}. غير الكود صافي بلا شرح. الكود خاصو يكون نقي`
                const code = await askGroq(sender, [{role:"user", content: prompt}])
                await sock.sendMessage(sender, { text: '```\n' + code + '\n```\n\nالكود من عند ' + BOT_NAME })

            } else if (cmd === '/نكتة') {
                const joke = await askGroq(sender, [{role:"user", content: "قول نكتة مغربية قصيرة وضحك"}])
                await sock.sendMessage(sender, { text: joke })

            } else if (cmd === '/صفر') {
                userMemory[sender] = []
                await sock.sendMessage(sender, { text: `صافي صفرت الذاكرة 🧹\n${BOT_NAME} نسا كلشي` })

            } else if (cmd === '/help') {
                await sock.sendMessage(sender, { text: `*${BOT_NAME}* - الميزات:\n\n1. /صورة + وصف\n2. /حلل + تصويرة\n3. /كود + نوع الكود\n4. /نكتة\n5. /صفر\n6. /مالك\n\n*مطور بواسطة ${DEVELOPER}*` })

            } else if (cmd === '/مالك' || cmd === '/بوت') {
                await sock.sendMessage(sender, { text: `أنا *${BOT_NAME}* 🤖\nصنعني المعلم *${DEVELOPER}* باش نعاونك\n\nشنو بغيتي ندير ليك؟` })

            } else if (text) {
                if (!userMemory[sender]) userMemory[sender] = []
                userMemory[sender].push({role: "user", content: text})
                const reply = await askGroq(sender, userMemory[sender])
                userMemory[sender].push({role: "assistant", content: reply})
                await sock.sendMessage(sender, { text: reply })
            }
        } catch (e) {
            await sock.sendMessage(sender, { text: `وقع خطأ أخويا، ${DEVELOPER} غادي يصايبو 😅` })
        }
    })
}

startBot()
