import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

import { UploadField, type UploadFieldError } from "./UploadField";

const makeFile = (name: string, type: string, size: number): File => {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

const selectFile = (file: File) => {
  const input = screen.getByLabelText("商標");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
};

describe("UploadField", () => {
  it("空狀態顯示拖放提示與說明文字", () => {
    render(<UploadField label="商標" hint="PNG / JPG,2MB 以內" />);

    expect(screen.getByText("點擊或拖曳圖片至此")).not.toBeNull();
    expect(screen.getByText("PNG / JPG,2MB 以內")).not.toBeNull();
  });

  it("選到合格檔案時回傳 File 並顯示預覽", () => {
    const handleChange = jest.fn();
    render(
      <UploadField
        label="商標"
        accept={["image/png"]}
        maxSize={2048}
        onChange={handleChange}
      />,
    );

    const file = makeFile("logo.png", "image/png", 1024);
    selectFile(file);

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange.mock.calls[0]?.[0]).toBe(file);
    expect(screen.getByText("logo.png")).not.toBeNull();
    expect(screen.getByText("1 KB")).not.toBeNull();
  });

  it("型別不在 accept 內時拒絕,顯示錯誤且不回傳檔案", () => {
    const handleChange = jest.fn();
    const handleError = jest.fn();
    render(
      <UploadField
        label="商標"
        accept={["image/png", "image/jpeg"]}
        onChange={handleChange}
        onError={handleError}
      />,
    );

    selectFile(makeFile("report.pdf", "application/pdf", 100));

    expect(handleChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("檔案格式不支援");
    const error = handleError.mock.calls[0]?.[0] as UploadFieldError;
    expect(error.code).toBe("INVALID_TYPE");
    expect(error.file.name).toBe("report.pdf");
  });

  it("副檔名寫法的 accept 也擋得下來", () => {
    const handleError = jest.fn();
    render(
      <UploadField label="商標" accept={[".png"]} onError={handleError} />,
    );

    selectFile(makeFile("logo.gif", "image/gif", 100));

    expect((handleError.mock.calls[0]?.[0] as UploadFieldError).code).toBe(
      "INVALID_TYPE",
    );
  });

  it("超過 maxSize 時拒絕並回報 FILE_TOO_LARGE", () => {
    const handleChange = jest.fn();
    const handleError = jest.fn();
    render(
      <UploadField
        label="商標"
        accept={["image/*"]}
        maxSize={1024}
        onChange={handleChange}
        onError={handleError}
      />,
    );

    selectFile(makeFile("big.png", "image/png", 4096));

    expect(handleChange).not.toHaveBeenCalled();
    expect((handleError.mock.calls[0]?.[0] as UploadFieldError).code).toBe(
      "FILE_TOO_LARGE",
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "檔案大小超過上限(1 KB)",
    );
  });

  it("按移除後回到空狀態並回傳 null", () => {
    const handleChange = jest.fn();
    render(<UploadField label="商標" onChange={handleChange} />);

    selectFile(makeFile("logo.png", "image/png", 1024));
    fireEvent.click(screen.getByRole("button", { name: "移除" }));

    expect(handleChange.mock.calls[1]?.[0]).toBeNull();
    expect(screen.getByText("點擊或拖曳圖片至此")).not.toBeNull();
  });

  it("拖放檔案與點擊選檔走同一套驗證", () => {
    const handleChange = jest.fn();
    render(
      <UploadField
        label="商標"
        accept={["image/png"]}
        onChange={handleChange}
      />,
    );

    // 拖放區是包住 label 的虛線方塊
    const dropZone = screen
      .getByLabelText("商標")
      .closest("label")?.parentElement;
    if (dropZone === null || dropZone === undefined) {
      throw new Error("找不到拖放區");
    }
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [makeFile("logo.png", "image/png", 512)] },
    });

    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  describe("initialPreviewUrl(編輯情境的既有圖片)", () => {
    const LOGO_URL = "https://cdn.test/tenant-a.png";

    it("一開啟就顯示既有圖片的預覽,不是空狀態", () => {
      render(<UploadField label="商標" initialPreviewUrl={LOGO_URL} />);

      expect(screen.queryByText("點擊或拖曳圖片至此")).toBeNull();
      expect(screen.getByText("目前的圖片")).not.toBeNull();
      expect(document.querySelector("img")?.getAttribute("src")).toBe(LOGO_URL);
    });

    it("選了新檔就換成新檔的預覽(換圖行為不變)", () => {
      const handleChange = jest.fn();
      render(
        <UploadField
          label="商標"
          initialPreviewUrl={LOGO_URL}
          onChange={handleChange}
        />,
      );

      selectFile(makeFile("new-logo.png", "image/png", 1024));

      expect(screen.getByText("new-logo.png")).not.toBeNull();
      expect(screen.queryByText("目前的圖片")).toBeNull();
      expect(handleChange.mock.calls[0]?.[0]).not.toBeNull();
    });

    it("按移除後既有圖片一併清掉、回到空狀態並回傳 null(清除行為不變)", () => {
      const handleChange = jest.fn();
      render(
        <UploadField
          label="商標"
          initialPreviewUrl={LOGO_URL}
          onChange={handleChange}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "移除" }));

      expect(handleChange.mock.calls[0]?.[0]).toBeNull();
      expect(screen.getByText("點擊或拖曳圖片至此")).not.toBeNull();
    });

    it("沒給 initialPreviewUrl 時維持原本的空狀態", () => {
      render(<UploadField label="商標" />);

      expect(screen.getByText("點擊或拖曳圖片至此")).not.toBeNull();
      expect(screen.queryByRole("button", { name: "移除" })).toBeNull();
    });
  });
});
