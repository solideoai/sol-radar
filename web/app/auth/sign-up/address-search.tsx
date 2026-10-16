"use client";

import { SearchIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type PostcodeSelection, toAddress } from "./sign-up-schema";

// 카카오 우편번호 서비스(https://postcode.map.kakao.com/guide). 키가 없고 상업적 용도도 무료다.
// 스크립트는 "주소 검색"을 처음 누를 때만 불러온다 — 가입 화면을 여는 것만으로 바깥 서버에 요청하지 않는다.
// 결과 창은 팝업(open) 대신 대화상자 안에 넣는다(embed). 모바일에서 새 탭이 열리지 않고, 이 화면의 틀 안에 머문다.
const POSTCODE_SCRIPT = "https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";

type PostcodeInstance = { embed: (element: HTMLElement) => void };
type PostcodeConstructor = new (options: {
  oncomplete: (selection: PostcodeSelection) => void;
  // 레이어(embed) 모드에서는 결과를 골라 서비스가 스스로 창을 정리한 뒤에만 불린다.
  onclose: () => void;
  width: string;
  height: string;
}) => PostcodeInstance;

declare global {
  interface Window {
    kakao?: { Postcode?: PostcodeConstructor };
  }
}

// 검색 창을 넣은 자리. 개발 모드(StrictMode)는 ref 콜백을 두 번 불러, 막지 않으면 같은 자리에 창이 둘 생기고
// 밀려난 첫 창의 스크립트가 오류를 낸다. 자리가 바뀌면(대화상자를 다시 열면) 새로 넣는다.
const embeddedNodes = new WeakSet<HTMLElement>();

// 한 번만 불러온다. 실패하면 비워 두어 다음 클릭에서 다시 시도한다.
const loader: { promise: Promise<PostcodeConstructor> | null } = { promise: null };

function loadPostcode(): Promise<PostcodeConstructor> {
  loader.promise ??= new Promise<PostcodeConstructor>((resolve, reject) => {
    const loaded = window.kakao?.Postcode;
    if (loaded) {
      resolve(loaded);
      return;
    }
    const script = document.createElement("script");
    script.src = POSTCODE_SCRIPT;
    script.async = true;
    script.onload = () => {
      const Postcode = window.kakao?.Postcode;
      if (Postcode) resolve(Postcode);
      else reject(new Error("우편번호 서비스가 준비되지 않았습니다"));
    };
    script.onerror = () => reject(new Error("우편번호 서비스를 불러오지 못했습니다"));
    document.head.append(script);
  }).catch((error: unknown) => {
    loader.promise = null;
    throw error;
  });
  return loader.promise;
}

// focusAfterSelect: 주소를 고른 뒤 초점을 둘 칸(상세 주소). 고르지 않고 닫으면 "주소 검색" 버튼으로 돌아간다.
export function AddressSearch({
  onSelect,
  focusAfterSelect,
}: {
  onSelect: (address: { postcode: string; address: string }) => void;
  focusAfterSelect: () => HTMLElement | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasSelectedRef = useRef(false);

  // 대화상자가 그려지면 그 자리에 검색 창을 넣는다. 닫으면 자리와 함께 사라진다.
  const embedInto = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || embeddedNodes.has(node)) return;
      embeddedNodes.add(node);
      loadPostcode()
        .then((Postcode) =>
          new Postcode({
            oncomplete: (selection) => {
              hasSelectedRef.current = true;
              onSelect(toAddress(selection));
            },
            // oncomplete 에서 바로 닫으면 서비스가 정리하려던 iframe 이 먼저 사라져 서비스 스크립트가 오류를 낸다.
            onclose: () => setIsOpen(false),
            width: "100%",
            height: "100%",
          }).embed(node),
        )
        .catch(() =>
          setError(
            "주소 검색을 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요. 주소는 선택 항목이라 비워 두고 가입해도 됩니다.",
          ),
        );
    },
    [onSelect],
  );

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setError(null);
          hasSelectedRef.current = false;
          setIsOpen(true);
        }}
      >
        <SearchIcon data-icon="inline-start" />
        주소 검색
      </Button>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent
          className="gap-3"
          finalFocus={() => (hasSelectedRef.current ? focusAfterSelect() : true)}
        >
          <DialogHeader>
            <DialogTitle>주소 검색</DialogTitle>
            <DialogDescription>
              도로명·건물명·지번으로 찾고, 결과를 누르면 채워집니다.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="type-label text-destructive">
              {error}
            </p>
          ) : (
            // 서비스의 최소 높이는 400px 이다. 폭은 대화상자를 따른다.
            <div
              ref={embedInto}
              className="h-[28rem] w-full overflow-hidden rounded-lg border border-border"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
