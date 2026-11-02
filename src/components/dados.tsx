import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, HardDrive, Trash2, Upload } from 'lucide-react';
import { expensesToTsv, isoDate, monthLabel } from '../lib/finance';
import { IS_DEMO, parseSavedFile, savedFileText, useFinance } from '../lib/financeStore';
import { SyncChip, statusLabel } from './finance';
import { Poster } from './poster';
import { useToast } from './toast';

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Converte a lista separada por tabulação em CSV com ";" (o que o Excel em português espera). */
const tsvToCsv = (tsv: string) =>
  '﻿' +
  tsv
    .split('\n')
    .map((line) =>
      line
        .split('\t')
        .map((c) => `"${c.replace(/"/g, '""')}"`)
        .join(';'),
    )
    .join('\r\n');

export function DataView({ now }: { now: Date }) {
  const fin = useFinance();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<{ name: string; data: NonNullable<ReturnType<typeof parseSavedFile>> } | null>(null);
  const today = isoDate(now);
  const months = [...new Set(fin.expenses.map((e) => e.competence))].sort();

  const exportBackup = () => {
    download(`orla-backup-${today}.json`, savedFileText(fin.expenses, fin.hasChanges ? fin.budgets : null, fin.invest, fin.goals), 'application/json');
    toast('Backup baixado. Guarde num pen drive ou na nuvem.', 'success');
  };

  const exportSheet = () => {
    const list = [...fin.expenses].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    download(`orla-lancamentos-${today}.csv`, tsvToCsv(expensesToTsv(list, today, statusLabel)), 'text/csv;charset=utf-8');
    toast('Planilha baixada. Ela abre no Excel ou no Google Planilhas.', 'success');
  };

  const pickFile = async (f: File) => {
    try {
      const data = parseSavedFile(JSON.parse(await f.text()));
      if (!data) throw new Error('formato');
      setPendingRestore({ name: f.name, data });
    } catch {
      toast('Esse arquivo não parece ser um backup do Orla.', 'error');
    }
  };

  const restore = () => {
    if (!pendingRestore) return;
    const list = Object.values(pendingRestore.data.overrides).flatMap((o) => (o.kind === 'upsert' ? [o.expense] : []));
    const { invest: inv, goals } = pendingRestore.data;
    fin.replaceAll(list, pendingRestore.data.budgets, inv, goals);
    setPendingRestore(null);
    const extras = [inv.list.length ? `${inv.list.length} investimentos` : '', goals.length ? `${goals.length} metas` : ''].filter(Boolean);
    toast(`Backup restaurado: ${list.length} lançamentos${extras.length ? ` e ${extras.join(' e ')}` : ''}.`, 'success');
  };

  return (
    <>
      <Poster kicker="Dados e backup" lines={[{ text: 'Seus dados.' }, { text: fin.mode === 'local' ? 'No navegador.' : 'No seu PC.', accent: true }]} sub="Nada vai para a internet. Baixe um backup de vez em quando." />
      <div className="grid data-grid">
        <section className="sheet sheet-solo" aria-labelledby="dados-onde">
          <div className="block">
            <div className="block-head">
              <div>
                <h2 className="card-title" id="dados-onde">
                  Onde ficam seus dados
                </h2>
                <p className="block-sub">
                  {fin.expenses.length
                    ? `${fin.expenses.length} lançamentos, de ${monthLabel(months[0])} a ${monthLabel(months[months.length - 1])}`
                    : 'Nenhum lançamento ainda'}
                  {fin.invest.list.length ? `, ${fin.invest.list.length} ${fin.invest.list.length === 1 ? 'investimento' : 'investimentos'}` : ''}
                  {fin.goals.length ? `, ${fin.goals.length} ${fin.goals.length === 1 ? 'meta' : 'metas'}` : ''}
                </p>
              </div>
              <SyncChip mode={fin.mode} sync={fin.sync} />
            </div>
            <div className="data-where">
              <span className="data-where-icon" aria-hidden="true">
                <HardDrive size={20} />
              </span>
              {IS_DEMO ? (
                <div>
                  <p>
                    Esta é a <strong>demonstração</strong>: os números são de exemplo e o que você mudar fica só neste navegador.
                  </p>
                  <p className="data-where-note">Para usar com os seus dados, baixe o projeto e rode no seu computador. Aí tudo fica num arquivo na pasta do projeto.</p>
                </div>
              ) : fin.mode === 'local' ? (
                <div>
                  <p>
                    O arquivo de dados não respondeu, então tudo está salvo <strong>só neste navegador</strong>.
                  </p>
                  <p className="data-where-note">Feche esta aba e abra o painel pelo Iniciar.bat. Enquanto isso, baixe um backup de vez em quando.</p>
                </div>
              ) : (
                <div>
                  <p>
                    Tudo fica no arquivo <code>orla-gastos/dados/orla-financas.json</code>, neste computador. Nada vai para a internet.
                  </p>
                  <p className="data-where-note">
                    Uma cópia é guardada todo dia em <code>dados/backups</code> (ficam os últimos 30 dias). O navegador também guarda uma cópia, por segurança.
                  </p>
                </div>
              )}
            </div>
            <div className="block-actions">
              <button type="button" className="btn btn-primary" onClick={exportBackup}>
                <Download size={16} aria-hidden="true" />
                Baixar backup
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
                <Upload size={16} aria-hidden="true" />
                Restaurar backup
              </button>
              <button type="button" className="btn btn-secondary" onClick={exportSheet} disabled={!fin.expenses.length}>
                <FileSpreadsheet size={16} aria-hidden="true" />
                Exportar planilha
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) pickFile(f);
                  e.target.value = '';
                }}
              />
            </div>
            {pendingRestore ? (
              <div className="discard data-confirm" role="alert">
                <p>
                  Trocar os {fin.expenses.length} lançamentos atuais pelos {Object.keys(pendingRestore.data.overrides).length} do arquivo “{pendingRestore.name}”
                  {pendingRestore.data.invest.list.length ? ` (com ${pendingRestore.data.invest.list.length} investimentos)` : ''}
                  {pendingRestore.data.goals.length ? ` (com ${pendingRestore.data.goals.length} metas)` : ''}?
                </p>
                <button type="button" className="btn btn-secondary" onClick={() => setPendingRestore(null)}>
                  Cancelar
                </button>
                <button type="button" className="btn btn-primary" onClick={restore}>
                  Restaurar
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <section className="sheet sheet-solo" aria-labelledby="dados-apagar">
          <div className="block">
            <div className="block-head">
              <div>
                <h2 className="card-title" id="dados-apagar">
                  Começar de novo
                </h2>
                <p className="block-sub">Apaga todos os lançamentos, limites, investimentos e metas. Os backups diários da pasta dados/backups continuam lá.</p>
              </div>
            </div>
            {confirmClear ? (
              <div className="discard data-confirm" role="alert">
                <p>Apagar tudo? Baixe um backup antes, se quiser guardar.</p>
                <button type="button" className="btn btn-secondary" onClick={() => setConfirmClear(false)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    setConfirmClear(false);
                    fin.clearAll().then(() => toast('Tudo apagado', 'info'));
                  }}
                >
                  Apagar tudo
                </button>
              </div>
            ) : (
              <div className="block-actions">
                <button type="button" className="btn btn-danger" onClick={() => setConfirmClear(true)} disabled={!fin.hasChanges}>
                  <Trash2 size={16} aria-hidden="true" />
                  Apagar todos os dados
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
