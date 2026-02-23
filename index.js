import express from 'express';
import fetch from 'node-fetch';
import csv from 'csv-parser';

const app = express();
app.use(express.json());

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

    // Tenta pegar o userId de várias formas possíveis (padrão SURI)
    const userId = req.body.userId || (req.body.contact && req.body.contact.identity);
    const messageText = req.body.message && req.body.message.text ? req.body.message.text : "";
    // Captura um campo extra 'action' para chamadas diretas do fluxo
    const action = req.body.action;
    // Verifica se existe a tag 'pedir_agenda' no contato (caso use a estratégia de Tag)
    const tags = req.body.contact && req.body.contact.tags ? req.body.contact.tags : [];
    const hasTag = Array.isArray(tags) && tags.some(t => (typeof t === 'string' ? t : t.name).includes('pedir_agenda'));

    if (!userId) return res.status(400).send("userId não encontrado no webhook");
    
    const isAgendaKeyword = messageText && messageText.toLowerCase().includes("agenda");
    const isAction = action === "agenda";
    // Só considera a tag se NÃO houver texto de mensagem (geralmente eventos de sistema como change-queue não trazem o texto da msg)
    const isTagEvent = hasTag && !messageText; 

    // Filtro: Aceita se: 1. Texto tem "agenda" | 2. Action é "agenda" | 3. É um evento de Tag (sem mensagem de texto junto)
    if (!isAgendaKeyword && !isAction && !isTagEvent) {
        return res.send("Ignorado: não atendeu aos critérios de disparo (palavra-chave, action ou tag sem mensagem).");
    }

    try {
        const response = await fetch(SHEET_URL);
        if (!response.ok) throw new Error(`Erro ao baixar planilha: ${response.statusText}`);

        const rows = [];
        
        // mapHeaders remove espaços acidentais (ex: " VAGAS " vira "VAGAS")
        response.body.pipe(csv({ mapHeaders: ({ header }) => header.trim() }))
        .on('data', row => rows.push(row))
        .on('end', async () => {
            try {
                // Monta uma única mensagem com todos os horários
                let mensagemFinal = "📅 *Agenda de Hoje*\n\n";
                
                // Filtra apenas horários com vagas positivas
                const horariosDisponiveis = rows.filter(row => row.HORARIO && parseInt(row.VAGAS, 10) > 0);

                if (horariosDisponiveis.length === 0) {
                    mensagemFinal += "🚫 Não há vagas disponíveis no momento.";
                } else {
                    for (const row of horariosDisponiveis) {
                        const { DIA, HORARIO, MEDICO, VAGAS } = row;
                        // Capitaliza o nome (ex: pedro -> Pedro)
                        const medicoFormatado = MEDICO ? MEDICO.charAt(0).toUpperCase() + MEDICO.slice(1) : 'Plantão';
                        mensagemFinal += `📅 ${DIA} às ${HORARIO} - Dr(a). ${medicoFormatado} (${VAGAS} vagas)\n`;
                    }
                }

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
                            templateId: "",
                            BodyParameters: [mensagemFinal]
                        }
                    })
                });

                if (!suriResponse.ok) {
                    console.error("Erro SURI:", await suriResponse.text());
                }

                res.json({ success: true, message: "Agenda processada" });
            } catch (innerError) {
                console.error("Erro no processamento interno:", innerError);
                // Não enviamos res.status(500) aqui pois o res pode já ter sido enviado se houver timeout, 
                // mas garante que o erro apareça no log do Render.
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).send("Erro ao enviar agenda");
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Servidor rodando na porta ${port}`));