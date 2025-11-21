// src/components/RuleEditorModal.tsx
import { useState, useEffect } from "react";
import type { RecurringRule } from "../domain/types";

interface RuleEditorModalProps {
  rule: RecurringRule | null;
  defaultStartDate: string;
  canDelete: boolean;
  onSave: (rule: RecurringRule) => void;
  onDelete: (ruleId: string) => void;
  onClose: () => void;
}

export default function RuleEditorModal({
  rule,
  defaultStartDate,
  canDelete,
  onSave,
  onDelete,
  onClose,
}: RuleEditorModalProps) {
  const [name, setName] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [isVariable, setIsVariable] = useState(false);

  const [scheduleType, setScheduleType] = useState<
    "monthly" | "twiceMonth" | "biweekly"
  >("monthly");

  const [day, setDay] = useState(1);
  const [day1, setDay1] = useState(15);
  const [day2, setDay2] = useState(31);
  const [businessDayConvention, setBusinessDayConvention] = useState<
    "none" | "previousBusinessDayUS"
  >("none");

  const [anchorDate, setAnchorDate] = useState(defaultStartDate);

  useEffect(() => {
    if (!rule) return;

    setName(rule.name);
    setAmountStr(String(rule.amount));
    setIsVariable(rule.isVariable);

    const sched = rule.schedule;
    setScheduleType(sched.type);

    if (sched.type === "monthly") {
      setDay(sched.day);
    } else if (sched.type === "twiceMonth") {
      setDay1(sched.day1);
      setDay2(sched.day2);
      setBusinessDayConvention(sched.businessDayConvention ?? "none");
    } else if (sched.type === "biweekly") {
      setAnchorDate(sched.anchorDate || defaultStartDate);
    }
  }, [rule, defaultStartDate]);

  if (!rule) return null;

  function handleSave() {
    if (!rule) return;

    const cleanedAmount =
      amountStr.trim() === "" ? 0 : Number(amountStr.trim()) || 0;

    let schedule: RecurringRule["schedule"];
    if (scheduleType === "monthly") {
      const safeDay = clampInt(day, 1, 31);
      schedule = {
        type: "monthly",
        day: safeDay,
      };
    } else if (scheduleType === "twiceMonth") {
      const safeDay1 = clampInt(day1, 1, 31);
      const safeDay2 = clampInt(day2, 1, 31);
      schedule = {
        type: "twiceMonth",
        day1: safeDay1,
        day2: safeDay2,
        businessDayConvention,
      };
    } else {
      const effectiveAnchor =
        anchorDate && anchorDate.trim().length > 0
          ? anchorDate
          : defaultStartDate;
      schedule = {
        type: "biweekly",
        anchorDate: effectiveAnchor,
      };
    }

    const updated: RecurringRule = {
      id: rule.id,
      name: name.trim() === "" ? "Untitled Rule" : name.trim(),
      amount: cleanedAmount,
      isVariable,
      schedule,
    };

    onSave(updated);
  }

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <h3 style={{ marginTop: 0 }}>Edit Recurring Rule</h3>

        <label style={styles.label}>
          Name
          <input
            style={styles.input}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label style={styles.label}>
          Amount (positive = inflow, negative = outflow)
          <input
            style={styles.input}
            type="number"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
          />
        </label>

        <label style={{ ...styles.label, flexDirection: "row", gap: 8 }}>
          <input
            type="checkbox"
            checked={isVariable}
            onChange={(e) => setIsVariable(e.target.checked)}
          />
          <span>Variable amount (will often override per event)</span>
        </label>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>Schedule</div>

          <label style={styles.label}>
            Frequency
            <select
              style={styles.input}
              value={scheduleType}
              onChange={(e) =>
                setScheduleType(e.target.value as typeof scheduleType)
              }
            >
              <option value="monthly">Monthly</option>
              <option value="twiceMonth">Twice a Month</option>
              <option value="biweekly">Biweekly</option>
            </select>
          </label>

          {scheduleType === "monthly" && (
            <label style={styles.label}>
              Day of month (1–31)
              <input
                style={styles.input}
                type="number"
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
              />
            </label>
          )}

          {scheduleType === "twiceMonth" && (
            <>
              <label style={styles.label}>
                First day (1–31)
                <input
                  style={styles.input}
                  type="number"
                  value={day1}
                  onChange={(e) => setDay1(Number(e.target.value))}
                />
              </label>

              <label style={styles.label}>
                Second day (1–31)
                <input
                  style={styles.input}
                  type="number"
                  value={day2}
                  onChange={(e) => setDay2(Number(e.target.value))}
                />
              </label>

              <div style={styles.hint}>
                Tip: if you want “last day of month”, set the day to 31.
                The engine will automatically clamp to 28/29/30 and then
                apply the business day rule.
              </div>

              <label style={styles.label}>
                Business day adjustment
                <select
                  style={styles.input}
                  value={businessDayConvention}
                  onChange={(e) =>
                    setBusinessDayConvention(
                      e.target.value as "none" | "previousBusinessDayUS"
                    )
                  }
                >
                  <option value="none">Use calendar date</option>
                  <option value="previousBusinessDayUS">
                    Move to previous US business day
                  </option>
                </select>
              </label>
            </>
          )}

          {scheduleType === "biweekly" && (
            <label style={styles.label}>
              Anchor date (first occurrence)
              <input
                style={styles.input}
                type="date"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
              />
            </label>
          )}
        </div>

        <div style={styles.buttonRow}>
          <button onClick={handleSave} style={styles.saveBtn}>
            Save
          </button>
          {canDelete && (
            <button
              onClick={() => onDelete(rule.id)}
              style={styles.deleteBtn}
            >
              Delete
            </button>
          )}
          <button onClick={onClose} style={styles.cancelBtn}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

const styles: Record<string, any> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 999,
  },
  modal: {
    background: "#111827",
    padding: 20,
    borderRadius: 12,
    width: "92%",
    maxWidth: 380,
    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
    maxHeight: "90vh",
    overflowY: "auto",
    border: "1px solid #1f2937",
    color: "#e5e7eb",
  },
  label: {
    display: "flex",
    flexDirection: "column",
    marginBottom: 10,
    fontSize: 14,
  },
  input: {
    marginTop: 5,
    padding: 8,
    fontSize: 15,
    background: "#020617",
    color: "#e5e7eb",
    border: "1px solid #4b5563",
    borderRadius: 8,
  },
  section: {
    marginTop: 10,
    marginBottom: 10,
    paddingTop: 8,
    borderTop: "1px solid #1f2937",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    color: "#9ca3af",
    marginBottom: 8,
  },
  buttonRow: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 16,
    gap: 8,
  },
  saveBtn: {
    flex: 1,
    padding: "8px 10px",
    background: "#2563eb",
    color: "#f9fafb",
    border: "none",
    borderRadius: 999,
    fontSize: 15,
  },
  deleteBtn: {
    flex: 1,
    padding: "8px 10px",
    background: "#b91c1c",
    color: "#f9fafb",
    border: "none",
    borderRadius: 999,
    fontSize: 15,
  },
  cancelBtn: {
    flex: 1,
    padding: "8px 10px",
    background: "#4b5563",
    color: "#e5e7eb",
    border: "none",
    borderRadius: 999,
    fontSize: 15,
  },
};
