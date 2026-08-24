import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeferredField } from "@/components/crm/lead/DeferredField";

describe("DeferredField", () => {
  it("keeps draft while typing and commits on blur", () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <DeferredField value="100" onCommit={onCommit} ariaLabel="Сумма" />,
    );
    const input = screen.getByLabelText("Сумма") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1500" } });
    expect(input.value).toBe("1500");
    expect(onCommit).not.toHaveBeenCalled();

    // External prop update while focused must not overwrite draft / jump cursor.
    rerender(<DeferredField value="999" onCommit={onCommit} ariaLabel="Сумма" />);
    expect(input.value).toBe("1500");

    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("1500");
  });

  it("strips non-digits when digitsOnly", () => {
    const onCommit = vi.fn();
    render(<DeferredField value="" onCommit={onCommit} digitsOnly ariaLabel="Сумма" />);
    const input = screen.getByLabelText("Сумма");
    fireEvent.change(input, { target: { value: "12ab34" } });
    expect((input as HTMLInputElement).value).toBe("1234");
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("1234");
  });
});
