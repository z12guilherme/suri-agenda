import express from 'express';
import fetch from 'node-fetch';
import csv from 'csv-parser';
import { Writable } from 'stream';

const app = express();
app.use(express.json());

const SURI_ENDPOINT = "https://cbm-wap-babysuri-cb89694138-dmi.azurewebsites.net/api/messages/send";
const SURI_TOKEN = "5e43b5ec-7311-4324-8c34-820850928cc9";
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRS_ZyTgZTYfscu6bZk3Abf3gWoHHZjikXAa_z8e9i3fRO9KwJUI3MYMf4oFxiE9RasmxUFwo6XfMfe/pub?output=csv";

app.get('/', (req, res) => {
    res.send("Servidor Suri-Agenda está online! 🚀");
});

app.post('/webhook/agenda', async (req, res) => {
    const userId = req.body.userId;
    if (!userId) return res.status(400).send("userId não encontrado no webhook");

    try {
        const response = await fetch(SHEET_URL);
        const csvData = await response.text();

        const rows = [];
        const parser = csv();
        parser.on('data', row => rows.push(row));
        parser.write(csvData);
        parser.end();

        parser.on('end', async () => {
            for (const row of rows) {
                const { DIA, HORARIO, MEDICO, VAGAS } = row;
                const mensagem = `📅 Agenda de Hoje - ${DIA}\n${HORARIO} - Dr. ${MEDICO}\nVagas: ${VAGAS}`;

                await fetch(SURI_ENDPOINT, {
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
                            BodyParameters: [mensagem]
                        }
                    })
                });
            }
            res.send("Agenda enviada com sucesso!");
        });

    } catch (error) {
        console.error(error);
        res.status(500).send("Erro ao enviar agenda");
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Servidor rodando na porta ${port}`));