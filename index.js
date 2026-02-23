import express from 'express';
import fetch from 'node-fetch';
import csv from 'csv-parser';

const app = express();
app.use(express.json());

// Middleware de Log Geral: Mostra no console qualquer acesso ao servidor
app.use((req, res, next) => {
    console.log(`🌍 [${req.method}] ${req.path}`);
    next();
});

const SURI_ENDPOINT = "https://cbm-wap-babysuri-cb89694138-dmi.azurewebsites.net/api/messages/send";
const SURI_TOKEN = "5e43b5ec-7311-4324-8c34-820850928cc9";
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRS_ZyTgZTYfscu6bZk3Abf3gWoHHZjikXAa_z8e9i3fRO9KwJUI3MYMf4oFxiE9RasmxUFwo6XfMfe/pub?output=csv";

app.get('/', (req, res) => {
    res.send("Servidor Suri-Agenda está online! 🚀");
});

// Adiciona uma resposta para quem tentar acessar via navegador (GET)
app.get('/webhook/agenda', (req, res) => {
    res.status(405).send("⚠️ Este endpoint é um Webhook e espera um método POST. Use o Postman ou a SURI para testar.");
});

app.post('/webhook/agenda', async (req, res) => {
    // Log para ver o que a SURI está mandando (útil para debug no Render)
    console.log("📩 Webhook recebido:", JSON.stringify(req.body, null, 2));

    const body = req.body;

    // 1. Tenta pegar dados do formato Customizado (Integração do Fluxo)
    let userId = body.userId;
    let action = body.action;
    let messageText = body.message && body.message.text ? body.message.text : "";
    let tags = body.contact && body.contact.tags ? body.contact.tags : [];
    let userName = body.contact && body.contact.name ? body.contact.name : "Desconhecido";

    // 2. Se não achou, tenta pegar do formato Webhook Global (SURI padrão - payload)
    if (!userId && body.payload && body.payload.user) {
        userId = body.payload.user.Id;
        tags = body.payload.user.Tags || [];
        userName = body.payload.user.Name || "Desconhecido";
    }
    if (!messageText && body.payload && body.payload.Message) {
        messageText = body.payload.Message.text;
    }

    // CORREÇÃO: Remove o prefixo do canal se o ID vier composto (ex: "wp...:5581...")
    if (userId && typeof userId === 'string' && userId.includes(':')) {
        const originalId = userId;
        userId = userId.split(':')[1];
        console.log(`🔧 ID ajustado de '${originalId}' para '${userId}'`);
    }

    // DEBUG: Mostra o que foi extraído para entender por que pode estar falhando
    console.log(`🔍 Debug Extração: Nome='${userName}', userId='${userId}', msg='${messageText}', action='${action}'`);

    const hasTag = Array.isArray(tags) && tags.some(t => (typeof t === 'string' ? t : t.name).includes('pedir_agenda'));

    if (!userId) return res.status(400).send("userId não encontrado no webhook");
    
    // Garante que messageText seja string antes de chamar toLowerCase
    const isAgendaKeyword = messageText && typeof messageText === 'string' && messageText.toLowerCase().includes("agenda");
    const isAction = action === "agenda";
    // Só considera a tag se NÃO houver texto de mensagem (geralmente eventos de sistema como change-queue não trazem o texto da msg)
    const isTagEvent = hasTag && !messageText; 

    console.log(`🛡️ Debug Filtros: keyword=${isAgendaKeyword}, action=${isAction}, tagEvent=${isTagEvent}`);

    // Filtro: Aceita se: 1. Texto tem "agenda" | 2. Action é "agenda" | 3. É um evento de Tag (sem mensagem de texto junto)
    if (!isAgendaKeyword && !isAction && !isTagEvent) {
        console.log("🚫 Ignorado pelos filtros.");
        return res.send("Ignorado: não atendeu aos critérios de disparo (palavra-chave, action ou tag sem mensagem).");
    }

    console.log(`🚀 Processando agenda para o ID: ${userId}`);

    try {
        console.log("📥 Baixando planilha do Google Sheets...");
        const response = await fetch(SHEET_URL);
        if (!response.ok) throw new Error(`Erro ao baixar planilha: ${response.statusText}`);
        console.log("✅ Planilha baixada com sucesso!");

        const rows = [];
        
        // mapHeaders remove espaços acidentais (ex: " VAGAS " vira "VAGAS")
        response.body.pipe(csv({ mapHeaders: ({ header }) => header.trim() }))
        .on('data', row => rows.push(row))
        .on('end', async () => {
            console.log(`📊 Leitura concluída. ${rows.length} linhas encontradas.`);
            try {
                // Monta uma única mensagem com todos os horários
                let mensagemFinal = "️ *Agenda Semanal*\n\n";
                
                // Filtra apenas horários com vagas positivas
                const horariosDisponiveis = rows.filter(row => row.HORARIO && parseInt(row.VAGAS, 10) > 0);

                if (horariosDisponiveis.length === 0) {
                    mensagemFinal += "🚫 Não há vagas disponíveis no momento.";
                } else {
                    for (const row of horariosDisponiveis) {
                        const { DIA, HORARIO, MEDICO, VAGAS } = row;
                        // Capitaliza o nome (ex: pedro -> Pedro)
                        const medicoFormatado = MEDICO ? MEDICO.charAt(0).toUpperCase() + MEDICO.slice(1) : 'Plantão';
                        mensagemFinal += `🗓️ ${DIA} às ${HORARIO} - Dr(a). ${medicoFormatado} (${VAGAS} vagas)\n`;
                    }
                }

                console.log("📤 Enviando resposta para SURI...");
                // Envia apenas uma mensagem consolidada
                const suriResponse = await fetch(SURI_ENDPOINT, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${SURI_TOKEN}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        userId,
                        message: {
                            text: mensagemFinal
                        }
                    })
                });

                const responseText = await suriResponse.text();
                if (!suriResponse.ok) {
                    console.error("❌ Erro SURI:", responseText);
                } else {
                    console.log("✅ Sucesso SURI:", responseText);
                }

                res.json({ success: true, message: "Agenda processada", suriResponse: responseText });
            } catch (innerError) {
                console.error("Erro no processamento interno:", innerError);
                // Garante que a requisição não fique travada se der erro aqui dentro
                if (!res.headersSent) res.status(500).json({ error: "Erro interno ao processar agenda", details: innerError.message });
            }
        });

        // Tratamento de erro do stream do CSV
        response.body.on('error', (err) => {
            console.error("❌ Erro na leitura do CSV:", err);
            res.status(500).send("Erro na leitura do CSV");
        });

    } catch (error) {
        console.error("❌ Erro fatal no processamento:", error);
        // Tenta avisar o usuário que deu erro para ele não ficar esperando
        try {
            await fetch(SURI_ENDPOINT, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${SURI_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, message: { text: "⚠️ Desculpe, ocorreu um erro ao consultar a agenda. Tente novamente em alguns minutos." } })
            });
        } catch (e) {
            console.error("Falha ao enviar mensagem de erro para o usuário:", e);
        }
        res.status(500).send("Erro ao enviar agenda");
    }
});

// Captura qualquer rota que não exista (404) e avisa no log
app.use((req, res) => {
    console.log(`⚠️ Rota desconhecida acessada: [${req.method}] ${req.path}`);
    res.status(404).send(`Erro 404: A rota '${req.path}' não existe neste servidor.`);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Servidor rodando na porta ${port} | Iniciado em: ${new Date().toISOString()}`));