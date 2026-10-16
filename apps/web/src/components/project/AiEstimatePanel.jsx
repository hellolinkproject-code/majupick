import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { parseApiError } from '../../lib/authApi.js';
import { requestPriceAnalysis } from '../../lib/aiApi.js';
import { formatWon } from '../../lib/profileForm.js';
import { validateBasics } from '../../lib/projectForm.js';

/**
 * AI 단가 분석 패널(B-01~B-03, D-28). 등록 퍼널 2단계·수정 화면에서 쓴다.
 * '예산에 반영'은 부모 form의 budget만 채운다(저장은 등록·수정 API).
 */
export function AiEstimatePanel({ form, setField, budgetLocked = false }) {
  const [report, setReport] = useState(null);
  const [localError, setLocalError] = useState('');

  const analyze = useMutation({
    mutationFn: () =>
      requestPriceAnalysis({
        title: form.title.trim(),
        description: form.description.trim(),
        ...(form.category ? { category: form.category } : {}),
        techStackIds: (form.techStacks ?? []).map((stack) => stack.id),
      }),
    onSuccess: (data) => {
      setReport(data);
      setLocalError('');
    },
    onError: (error) => {
      setReport(null);
      setLocalError(parseApiError(error).message);
    },
  });

  function handleAnalyze() {
    if (analyze.isPending || budgetLocked) return;
    const basicsErrors = validateBasics(form);
    if (Object.keys(basicsErrors).length > 0) {
      setLocalError('AI 분석을 위해 제목·카테고리·설명을 먼저 입력해 주세요.');
      return;
    }
    setLocalError('');
    analyze.mutate();
  }

  function handleApplyBudget() {
    if (!report?.totalAmount || budgetLocked) return;
    setField('budget', String(report.totalAmount).replace(/[^\d]/g, ''));
  }

  return (
    <section className="ai-estimate" aria-labelledby="ai-estimate-heading">
      <div className="ai-estimate__header">
        <h3 id="ai-estimate-heading">AI 단가 분석</h3>
        <p className="ai-estimate__lead">
          제목·설명·카테고리·기술 스택을 바탕으로 단위 기능별 예상 금액과 근거를 제안합니다. 결과는
          저장되지 않으며, 원하면 예산에 반영할 수 있습니다.
        </p>
      </div>

      <div className="ai-estimate__actions">
        <button
          type="button"
          className="button button--ghost"
          onClick={handleAnalyze}
          disabled={analyze.isPending || budgetLocked}
        >
          {analyze.isPending ? '분석하는 중…' : 'AI로 단가 분석'}
        </button>
        {budgetLocked && <p className="form-field__hint">지원자가 있어 예산을 바꿀 수 없습니다.</p>}
      </div>

      {localError && (
        <p className="form-alert" role="alert">
          {localError}
        </p>
      )}

      {report && (
        <div className="ai-estimate__report" aria-live="polite">
          {report.isMock && (
            <p className="ai-estimate__badge">모의(mock) 분석 결과 · 실제 LLM 호출 없음</p>
          )}
          <div className="ai-estimate__table-wrap">
            <table className="ai-estimate__table">
              <caption>단위 기능별 예상 단가</caption>
              <thead>
                <tr>
                  <th scope="col">기능</th>
                  <th scope="col">설명</th>
                  <th scope="col">예상 금액</th>
                  <th scope="col">산정 근거</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map((item) => (
                  <tr key={`${item.name}-${item.estimatedAmount}`}>
                    <td>{item.name}</td>
                    <td>{item.description}</td>
                    <td className="ai-estimate__amount">{formatWon(item.estimatedAmount)}</td>
                    <td>{item.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ai-estimate__total">
            총 예상 금액 <strong>{formatWon(report.totalAmount)}</strong>
          </p>
          {report.assumptions?.length > 0 && (
            <ul className="ai-estimate__assumptions">
              {report.assumptions.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="button"
            onClick={handleApplyBudget}
            disabled={budgetLocked}
          >
            예산에 반영
          </button>
        </div>
      )}
    </section>
  );
}
