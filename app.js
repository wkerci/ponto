import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const ROTULO_TIPO = {
  entrada: "Entrada",
  saida_almoco: "Saída Almoço",
  retorno_almoco: "Retorno Almoço",
  saida: "Saída",
};
const ORDEM_TIPOS = ["entrada", "saida_almoco", "retorno_almoco", "saida"];
const CAMPO_HORARIO = {
  entrada: "horarioEntrada",
  saida_almoco: "horarioSaidaAlmoco",
  retorno_almoco: "horarioRetornoAlmoco",
  saida: "horarioSaida",
};

// ---------- AUTENTICAÇÃO ----------

onAuthStateChanged(auth, (usuario) => {
  if (!usuario) {
    window.location.href = "index.html";
  }
});

document.getElementById("botaoSair").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// ---------- ABAS ----------

document.querySelectorAll(".aba").forEach((botao) => {
  botao.addEventListener("click", () => {
    document.querySelectorAll(".aba").forEach((b) => b.classList.remove("ativa"));
    document.querySelectorAll(".secao").forEach((s) => s.classList.remove("ativa"));
    botao.classList.add("ativa");
    document.getElementById(`secao-${botao.dataset.aba}`).classList.add("ativa");
  });
});

document.querySelectorAll(".subaba").forEach((botao) => {
  botao.addEventListener("click", () => {
    document.querySelectorAll(".subaba").forEach((b) => b.classList.remove("ativa"));
    document.querySelectorAll(".subsecao").forEach((s) => s.classList.remove("ativa"));
    botao.classList.add("ativa");
    document.getElementById(`subsecao-${botao.dataset.subaba}`).classList.add("ativa");
  });
});

// ---------- UTILITÁRIOS ----------

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function horaAgoraISO() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function calcularMinutosAtraso(horarioPrevisto, horaReal, tolerancia = 10) {
  if (!horarioPrevisto) return 0;
  try {
    const [ph, pm] = horarioPrevisto.split(":").map(Number);
    const [rh, rm] = horaReal.split(":").map(Number);
    const diff = rh * 60 + rm - (ph * 60 + pm);
    return diff > tolerancia ? diff : 0;
  } catch {
    return 0;
  }
}

// Horário previsto pro tipo de batida NUM DIA ESPECÍFICO — sábado usa
// horarioSabadoEntrada/horarioSabadoSaida (se cadastrados) em vez do
// horário de segunda-a-sexta, e domingo não tem horário previsto nenhum.
// Sem isso, toda batida de sábado era comparada com o horário errado.
function horarioPrevistoPara(f, tipo, dataISO) {
  const dia = new Date(`${dataISO}T00:00:00`);
  const diaSemana = dia.getDay(); // 0 = domingo, 6 = sábado
  if (diaSemana === 0) return null;
  if (diaSemana === 6) {
    if (tipo === "entrada") return f.horarioSabadoEntrada || null;
    if (tipo === "saida") return f.horarioSabadoSaida || null;
  }
  return f[CAMPO_HORARIO[tipo]] || null;
}

// Minutos-do-dia de "HH:mm" ou "HH:mm:ss", ou null se inválido/ausente.
function minutosDoDia(hora) {
  if (!hora) return null;
  const partes = hora.split(":").map(Number);
  if (partes.some((n) => Number.isNaN(n))) return null;
  return partes[0] * 60 + (partes[1] || 0);
}

// Horas trabalhadas no dia (em minutos), a partir das 4 batidas possíveis
// (entrada até saída, descontando o intervalo de almoço). Retorna null se
// faltar entrada ou saída.
function minutosTrabalhadosNoDia(pontosPorTipo) {
  const entrada = minutosDoDia(pontosPorTipo.entrada?.hora);
  const saida = minutosDoDia(pontosPorTipo.saida?.hora);
  if (entrada == null || saida == null) return null;

  let total = saida - entrada;
  const saidaAlmoco = minutosDoDia(pontosPorTipo.saida_almoco?.hora);
  const retornoAlmoco = minutosDoDia(pontosPorTipo.retorno_almoco?.hora);
  if (saidaAlmoco != null && retornoAlmoco != null) {
    total -= retornoAlmoco - saidaAlmoco;
  }
  return total;
}

// Jornada prevista pro dia (em minutos), considerando sábado/domingo.
function minutosPrevistosNoDia(f, dataISO) {
  const dia = new Date(`${dataISO}T00:00:00`);
  const diaSemana = dia.getDay();
  if (diaSemana === 0) return null;

  const entrada = minutosDoDia(
    diaSemana === 6 ? f.horarioSabadoEntrada : f.horarioEntrada
  );
  const saida = minutosDoDia(
    diaSemana === 6 ? f.horarioSabadoSaida : f.horarioSaida
  );
  if (entrada == null || saida == null) return null;

  let total = saida - entrada;
  const saidaAlmoco = minutosDoDia(f.horarioSaidaAlmoco);
  const retornoAlmoco = minutosDoDia(f.horarioRetornoAlmoco);
  if (saidaAlmoco != null && retornoAlmoco != null) {
    total -= retornoAlmoco - saidaAlmoco;
  }
  return total;
}

function formatarMinutos(minutos) {
  const m = Math.round(minutos);
  const h = Math.trunc(m / 60);
  const min = m % 60;
  if (h === 0) return `${min}min`;
  return `${h}h${String(min).padStart(2, "0")}min`;
}

function dataBr(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

// ---------- MONITORAMENTO: ABA DIA ----------

let diaSelecionadoMonitoramento = hojeISO();

async function carregarMonitoramento() {
  const diaEscolhido = diaSelecionadoMonitoramento;
  const ehHoje = diaEscolhido === hojeISO();
  const horaAgora = horaAgoraISO();

  const funcSnap = await getDocs(
    query(collection(db, "funcionarios"), where("ativo", "==", true))
  );
  const pontosSnap = await getDocs(
    query(collection(db, "pontos"), where("data", "==", diaEscolhido))
  );

  const pontosPorFuncionario = {};
  pontosSnap.forEach((doc) => {
    const p = doc.data();
    const id = String(p.funcionarioId);
    pontosPorFuncionario[id] = pontosPorFuncionario[id] || {};
    pontosPorFuncionario[id][p.tipo] = p;
  });

  const linhas = [];
  funcSnap.forEach((doc) => {
    const f = { id: doc.id, ...doc.data() };
    const pontosDele = pontosPorFuncionario[doc.id] || {};

    const situacoes = ORDEM_TIPOS.map((tipo) => {
      const horarioPrevisto = horarioPrevistoPara(f, tipo, diaEscolhido);
      const ponto = pontosDele[tipo];

      if (ponto) {
        const minutos = calcularMinutosAtraso(horarioPrevisto, ponto.hora);
        return {
          tipo,
          registrado: true,
          hora: ponto.hora,
          minutos,
          extra: tipo === "saida" && minutos > 0,
        };
      }
      // Só projeta "atrasado ao vivo" comparando com a hora atual quando o
      // dia escolhido é hoje — um dia passado já acabou, não tem "ao vivo".
      const minutos = !ehHoje || tipo === "saida"
        ? 0
        : calcularMinutosAtraso(horarioPrevisto, horaAgora);
      return { tipo, registrado: false, hora: null, minutos, extra: false };
    });

    const atrasado = situacoes.some((s) => s.minutos > 0 && !s.extra);
    const horaExtra = situacoes.some((s) => s.extra);

    linhas.push({ funcionario: f, situacoes, atrasado, horaExtra });
  });

  linhas.sort((a, b) => {
    if (a.atrasado === b.atrasado) return (a.funcionario.nome || "").localeCompare(b.funcionario.nome || "");
    return a.atrasado ? -1 : 1;
  });

  renderizarMonitoramento(linhas, ehHoje);
}

function renderizarMonitoramento(linhas, ehHoje) {
  const atrasados = linhas.filter((l) => l.atrasado);
  const notifDiv = document.getElementById("notificacoesHoje");

  if (!ehHoje || atrasados.length === 0) {
    notifDiv.innerHTML = "";
  } else {
    notifDiv.innerHTML = `
      <h3 style="font-size:15px;margin:0 0 10px;">Notificações de hoje (${atrasados.length})</h3>
      ${atrasados
        .map((l) => {
          const s = l.situacoes.find((s) => s.minutos > 0 && !s.extra);
          return `
          <div class="cartao notificacao">
            <strong>${escapeHtml(l.funcionario.nome)}</strong> está atrasado —
            ${s ? `${ROTULO_TIPO[s.tipo]}${s.registrado ? ` às ${s.hora}` : " (ainda não registrado)"} — ${s.minutos} min` : ""}
          </div>`;
        })
        .join("")}
      <div style="height:14px"></div>
    `;
  }

  const lista = document.getElementById("listaMonitoramento");

  if (linhas.length === 0) {
    lista.innerHTML = `<div class="vazio">Nenhum funcionário ativo cadastrado ainda.</div>`;
    return;
  }

  lista.innerHTML = linhas
    .map((l) => {
      const f = l.funcionario;
      const foto = f.fotoBase64
        ? `<img class="avatar" src="data:image/jpeg;base64,${f.fotoBase64}" />`
        : `<div class="avatar-vazio">👤</div>`;

      const selo = l.atrasado
        ? `<span class="selo selo-vermelho">Atrasado</span>`
        : l.horaExtra
        ? `<span class="selo selo-laranja">Hora extra</span>`
        : `<span class="selo selo-verde">Em dia</span>`;

      const chips = l.situacoes
        .map((s) => {
          let cor = "selo-cinza";
          let sufixo = "";
          if (s.registrado && s.minutos > 0 && s.extra) {
            cor = "selo-laranja";
            sufixo = ` (+${s.minutos} min extra)`;
          } else if (s.registrado && s.minutos > 0) {
            cor = "selo-vermelho";
            sufixo = ` (${s.minutos} min atraso)`;
          } else if (s.registrado) {
            cor = "selo-verde";
          } else if (!s.registrado && s.minutos > 0) {
            cor = "selo-vermelho";
            sufixo = ` (atrasado ${s.minutos} min)`;
          }
          return `<span class="chip">${ROTULO_TIPO[s.tipo]}: ${s.registrado ? s.hora : "--:--"}${sufixo}</span>`;
        })
        .join("");

      return `
        <div class="cartao">
          <div class="linha-funcionario">
            ${foto}
            <div class="info-funcionario">
              <div class="nome">${escapeHtml(f.nome)}</div>
              <div class="matricula">Matrícula: ${escapeHtml(f.matricula)}</div>
            </div>
            ${selo}
          </div>
          <div class="chips">${chips}</div>
        </div>`;
    })
    .join("");
}

document.getElementById("filtroDiaMonitoramento").addEventListener("change", (e) => {
  diaSelecionadoMonitoramento = e.target.value || hojeISO();
  carregarMonitoramento();
});

document.getElementById("botaoHojeMonitoramento").addEventListener("click", () => {
  diaSelecionadoMonitoramento = hojeISO();
  document.getElementById("filtroDiaMonitoramento").value = diaSelecionadoMonitoramento;
  carregarMonitoramento();
});

// ---------- MONITORAMENTO: ABA MÊS (RANKING) ----------

const MESES_PT_BR = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const hoje0 = new Date();
let mesSelecionado = { ano: hoje0.getFullYear(), mes: hoje0.getMonth() }; // mes: 0-11

function mudarMes(delta) {
  const novo = new Date(mesSelecionado.ano, mesSelecionado.mes + delta, 1);
  const atual = new Date(hoje0.getFullYear(), hoje0.getMonth(), 1);
  if (novo > atual) return; // não deixa ir pro futuro
  mesSelecionado = { ano: novo.getFullYear(), mes: novo.getMonth() };
  carregarRankingMes();
}

document.getElementById("botaoMesAnterior").addEventListener("click", () => mudarMes(-1));
document.getElementById("botaoMesProximo").addEventListener("click", () => mudarMes(1));

function pad2(n) {
  return String(n).padStart(2, "0");
}

async function carregarRankingMes() {
  const rotuloEl = document.getElementById("rotuloMes");
  rotuloEl.textContent = `${MESES_PT_BR[mesSelecionado.mes]} ${mesSelecionado.ano}`;

  const div = document.getElementById("rankingMes");
  div.className = "carregando";
  div.innerHTML = "Carregando...";

  const primeiroDia = `${mesSelecionado.ano}-${pad2(mesSelecionado.mes + 1)}-01`;
  const ultimoDiaMes = new Date(mesSelecionado.ano, mesSelecionado.mes + 1, 0);
  const hoje = new Date();
  const ultimoDia = ultimoDiaMes > hoje ? hoje : ultimoDiaMes;
  const ultimoDiaISO = `${ultimoDia.getFullYear()}-${pad2(ultimoDia.getMonth() + 1)}-${pad2(ultimoDia.getDate())}`;
  const ultimoDiaMesISO = `${ultimoDiaMes.getFullYear()}-${pad2(ultimoDiaMes.getMonth() + 1)}-${pad2(ultimoDiaMes.getDate())}`;

  const [funcSnap, pontosSnap] = await Promise.all([
    getDocs(query(collection(db, "funcionarios"), where("ativo", "==", true))),
    getDocs(
      query(
        collection(db, "pontos"),
        where("data", ">=", primeiroDia),
        where("data", "<=", ultimoDiaMesISO)
      )
    ),
  ]);

  const funcionarios = [];
  funcSnap.forEach((doc) => funcionarios.push({ id: doc.id, ...doc.data() }));

  // Agrupa: funcionarioId -> data -> tipo -> ponto (precisamos do dia
  // inteiro junto pra calcular hora extra de verdade — entrada até saída,
  // não só "quantos minutos depois do horário a pessoa bateu a saída").
  const porFuncionarioData = {};
  pontosSnap.forEach((doc) => {
    const p = doc.data();
    const fid = String(p.funcionarioId);
    porFuncionarioData[fid] = porFuncionarioData[fid] || {};
    porFuncionarioData[fid][p.data] = porFuncionarioData[fid][p.data] || {};
    porFuncionarioData[fid][p.data][p.tipo] = p;
  });

  const stats = funcionarios.map((f) => {
    const porData = porFuncionarioData[f.id] || {};
    let somaAtrasoEntrada = 0;
    let qtdEntrada = 0;
    let somaAtrasoRetorno = 0;
    let qtdRetorno = 0;
    let somaExtraMinutos = 0;
    let diasTrabalhados = 0;

    for (const [dataISO, pontosPorTipo] of Object.entries(porData)) {
      if (dataISO > ultimoDiaISO) continue; // não conta dias futuros

      if (pontosPorTipo.entrada) {
        somaAtrasoEntrada += calcularMinutosAtraso(
          horarioPrevistoPara(f, "entrada", dataISO),
          pontosPorTipo.entrada.hora
        );
        qtdEntrada++;
      }
      if (pontosPorTipo.retorno_almoco && f.horarioRetornoAlmoco) {
        somaAtrasoRetorno += calcularMinutosAtraso(
          horarioPrevistoPara(f, "retorno_almoco", dataISO),
          pontosPorTipo.retorno_almoco.hora
        );
        qtdRetorno++;
      }

      const trabalhado = minutosTrabalhadosNoDia(pontosPorTipo);
      if (trabalhado != null) {
        diasTrabalhados++;
        const previsto = minutosPrevistosNoDia(f, dataISO);
        if (previsto != null && trabalhado > previsto) {
          somaExtraMinutos += trabalhado - previsto;
        }
      }
    }

    return {
      nome: f.nome,
      qtdEntrada,
      qtdRetorno,
      diasTrabalhados,
      somaExtraMinutos,
      mediaAtrasoEntrada: qtdEntrada > 0 ? somaAtrasoEntrada / qtdEntrada : 0,
      mediaAtrasoRetorno: qtdRetorno > 0 ? somaAtrasoRetorno / qtdRetorno : 0,
    };
  });

  const comEntrada = stats.filter((s) => s.qtdEntrada > 0);
  const comRetorno = stats.filter((s) => s.qtdRetorno > 0);
  const comTrabalho = stats.filter((s) => s.diasTrabalhados > 0);

  const maisPontual = [...comEntrada].sort((a, b) => a.mediaAtrasoEntrada - b.mediaAtrasoEntrada);
  const maisAtrasado = [...comEntrada]
    .filter((s) => s.mediaAtrasoEntrada > 0)
    .sort((a, b) => b.mediaAtrasoEntrada - a.mediaAtrasoEntrada);
  const maisPontualRetorno = [...comRetorno].sort((a, b) => a.mediaAtrasoRetorno - b.mediaAtrasoRetorno);
  const maisHoraExtra = [...comTrabalho].sort((a, b) => b.somaExtraMinutos - a.somaExtraMinutos);
  const menosHoraExtra = [...comTrabalho].sort((a, b) => a.somaExtraMinutos - b.somaExtraMinutos);

  div.className = "";
  if (stats.length === 0) {
    div.innerHTML = `<div class="vazio">Nenhum funcionário ativo cadastrado.</div>`;
    return;
  }

  div.innerHTML = [
    rankingCard("🏆 Mais pontuais na entrada", "Menor atraso médio na entrada", "#1f8a54",
      maisPontual.slice(0, 5), (s) => s.mediaAtrasoEntrada, (s) => `${Math.round(s.mediaAtrasoEntrada)} min`),
    rankingCard("⚠️ Mais atrasados na entrada", "Maior atraso médio na entrada", "#c23b3b",
      maisAtrasado.slice(0, 5), (s) => s.mediaAtrasoEntrada, (s) => `${Math.round(s.mediaAtrasoEntrada)} min`),
    rankingCard("🍽️ Mais pontuais no retorno do almoço", "Menor atraso médio ao voltar do almoço", "#2f3b7a",
      maisPontualRetorno.slice(0, 5), (s) => s.mediaAtrasoRetorno, (s) => `${Math.round(s.mediaAtrasoRetorno)} min`),
    rankingCard("📈 Mais horas extras no mês", "Total de horas além da jornada prevista", "#c8720a",
      maisHoraExtra.slice(0, 5), (s) => s.somaExtraMinutos, (s) => formatarMinutos(s.somaExtraMinutos)),
    rankingCard("📉 Menos horas extras no mês", "Entre quem trabalhou ao menos 1 dia no período", "#5568d4",
      menosHoraExtra.slice(0, 5), (s) => s.somaExtraMinutos, (s) => formatarMinutos(s.somaExtraMinutos)),
  ].join("");
}

function rankingCard(titulo, subtitulo, cor, itens, valorFn, labelFn) {
  if (itens.length === 0) {
    return `
      <div class="ranking-cartao">
        <div class="ranking-titulo">${titulo}</div>
        <div class="ranking-subtitulo">${subtitulo}</div>
        <div class="vazio" style="padding:10px 0;">Sem dados suficientes neste período.</div>
      </div>`;
  }

  const maiorValor = Math.max(...itens.map((i) => Math.abs(valorFn(i))), 1);

  const linhas = itens
    .map((item) => {
      const valor = Math.abs(valorFn(item));
      const proporcao = Math.max(0.06, valor / maiorValor);
      return `
        <div class="ranking-linha">
          <div class="ranking-nome">${escapeHtml(item.nome)}</div>
          <div class="ranking-barra-fundo">
            <div class="ranking-barra-preenchida" style="width:${(proporcao * 100).toFixed(0)}%;background:${cor};"></div>
          </div>
          <div class="ranking-valor">${escapeHtml(labelFn(item))}</div>
        </div>`;
    })
    .join("");

  return `
    <div class="ranking-cartao">
      <div class="ranking-titulo">${titulo}</div>
      <div class="ranking-subtitulo">${subtitulo}</div>
      ${linhas}
    </div>`;
}

// ---------- FUNCIONÁRIOS ----------

async function carregarFuncionarios() {
  const snap = await getDocs(collection(db, "funcionarios"));
  const funcionarios = [];
  snap.forEach((doc) => funcionarios.push({ id: doc.id, ...doc.data() }));
  funcionarios.sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));

  const div = document.getElementById("listaFuncionarios");
  if (funcionarios.length === 0) {
    div.innerHTML = `<div class="vazio">Nenhum funcionário sincronizado ainda.</div>`;
    return;
  }

  div.innerHTML = funcionarios
    .map((f) => {
      const foto = f.fotoBase64
        ? `<img class="avatar" src="data:image/jpeg;base64,${f.fotoBase64}" />`
        : `<div class="avatar-vazio">👤</div>`;
      const selos = [
        f.isAdmin ? `<span class="selo selo-cinza">Admin</span>` : "",
        f.ativo === false ? `<span class="selo selo-vermelho">Inativo</span>` : "",
      ].join(" ");

      return `
        <div class="cartao">
          <div class="linha-funcionario">
            ${foto}
            <div class="info-funcionario">
              <div class="nome">${escapeHtml(f.nome)}</div>
              <div class="matricula">Matrícula: ${escapeHtml(f.matricula)}</div>
            </div>
            ${selos}
          </div>
          <div class="chips">
            <span class="chip">Entrada: ${f.horarioEntrada || "--:--"}</span>
            <span class="chip">Saída Almoço: ${f.horarioSaidaAlmoco || "--:--"}</span>
            <span class="chip">Retorno Almoço: ${f.horarioRetornoAlmoco || "--:--"}</span>
            <span class="chip">Saída: ${f.horarioSaida || "--:--"}</span>
          </div>
        </div>`;
    })
    .join("");

  preencherFiltroFuncionarios(funcionarios);
}

function preencherFiltroFuncionarios(funcionarios) {
  const select = document.getElementById("filtroFuncionario");
  select.innerHTML = `<option value="">Todos</option>` +
    funcionarios.map((f) => `<option value="${f.id}">${escapeHtml(f.nome)}</option>`).join("");
}

// ---------- RELATÓRIO ----------

async function carregarRelatorio() {
  const inicio = document.getElementById("filtroInicio").value;
  const fim = document.getElementById("filtroFim").value;
  const funcionarioId = document.getElementById("filtroFuncionario").value;
  const tabela = document.getElementById("tabelaRelatorio");

  if (!inicio || !fim) {
    tabela.innerHTML = `<div class="vazio">Escolha a data início e fim.</div>`;
    return;
  }

  tabela.innerHTML = `<div class="carregando">Carregando...</div>`;

  const condicoes = [where("data", ">=", inicio), where("data", "<=", fim)];
  if (funcionarioId) condicoes.push(where("funcionarioId", "==", Number(funcionarioId)));

  const snap = await getDocs(query(collection(db, "pontos"), ...condicoes));

  const grupos = {};
  snap.forEach((doc) => {
    const p = doc.data();
    const chave = `${p.funcionarioId}_${p.data}`;
    grupos[chave] = grupos[chave] || {
      nome: p.nome,
      matricula: p.matricula,
      data: p.data,
      tipos: {},
    };
    grupos[chave].tipos[p.tipo] = p.hora;
  });

  const linhas = Object.values(grupos).sort((a, b) => b.data.localeCompare(a.data));

  if (linhas.length === 0) {
    tabela.innerHTML = `<div class="vazio">Nenhum ponto encontrado nesse período.</div>`;
    return;
  }

  tabela.innerHTML = `
    <table>
      <thead>
        <tr><th>Funcionário</th><th>Matrícula</th><th>Data</th><th>Entrada</th><th>Saída Almoço</th><th>Retorno Almoço</th><th>Saída</th></tr>
      </thead>
      <tbody>
        ${linhas
          .map(
            (l) => `
          <tr>
            <td>${escapeHtml(l.nome)}</td>
            <td>${escapeHtml(l.matricula)}</td>
            <td>${dataBr(l.data)}</td>
            <td>${l.tipos.entrada || "--:--"}</td>
            <td>${l.tipos.saida_almoco || "--:--"}</td>
            <td>${l.tipos.retorno_almoco || "--:--"}</td>
            <td>${l.tipos.saida || "--:--"}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

document.getElementById("botaoFiltrarRelatorio").addEventListener("click", carregarRelatorio);

// ---------- LOGS ----------

async function carregarLogs() {
  const dia = document.getElementById("filtroDiaLog").value;
  const tabela = document.getElementById("tabelaLogs");

  if (!dia) {
    tabela.innerHTML = `<div class="vazio">Escolha um dia.</div>`;
    return;
  }

  tabela.innerHTML = `<div class="carregando">Carregando...</div>`;

  const snap = await getDocs(
    query(collection(db, "logs_auditoria"), where("data", "==", dia), orderBy("dataHora", "desc"))
  );

  const linhas = [];
  snap.forEach((doc) => linhas.push(doc.data()));

  if (linhas.length === 0) {
    tabela.innerHTML = `<div class="vazio">Nenhum log nesse dia.</div>`;
    return;
  }

  tabela.innerHTML = `
    <table>
      <thead>
        <tr><th>Data/Hora</th><th>Administrador</th><th>Ação</th><th>Detalhes</th></tr>
      </thead>
      <tbody>
        ${linhas
          .map(
            (l) => `
          <tr>
            <td>${escapeHtml(l.dataHora)}</td>
            <td>${escapeHtml(l.adminNome)}</td>
            <td>${escapeHtml(l.acao)}</td>
            <td>${escapeHtml(l.detalhes || "")}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

document.getElementById("botaoFiltrarLog").addEventListener("click", carregarLogs);

// ---------- INÍCIO ----------

document.getElementById("filtroDiaLog").value = hojeISO();
document.getElementById("filtroInicio").value = hojeISO();
document.getElementById("filtroFim").value = hojeISO();
document.getElementById("filtroDiaMonitoramento").value = hojeISO();

carregarMonitoramento();
carregarRankingMes();
carregarFuncionarios();
