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

// ---------- MONITORAMENTO DE HOJE ----------

async function carregarMonitoramento() {
  const hoje = hojeISO();
  const horaAgora = horaAgoraISO();

  const funcSnap = await getDocs(
    query(collection(db, "funcionarios"), where("ativo", "==", true))
  );
  const pontosSnap = await getDocs(
    query(collection(db, "pontos"), where("data", "==", hoje))
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
      const horarioPrevisto = f[CAMPO_HORARIO[tipo]];
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
      const minutos = tipo === "saida" ? 0 : calcularMinutosAtraso(horarioPrevisto, horaAgora);
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

  renderizarMonitoramento(linhas);
}

function renderizarMonitoramento(linhas) {
  const atrasados = linhas.filter((l) => l.atrasado);
  const notifDiv = document.getElementById("notificacoesHoje");

  if (atrasados.length === 0) {
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

carregarMonitoramento();
carregarFuncionarios();
