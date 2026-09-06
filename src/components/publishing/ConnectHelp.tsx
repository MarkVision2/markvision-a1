/**
 * Подсказки для клиента на публичной странице /connect/:token.
 *
 * Instagram (и в меньшей степени TikTok) считает вход по паролю с незнакомого
 * компьютера попыткой взлома и режет его на своей стороне — до того, как нам
 * вернётся `code`. Поймать это в коде нельзя: редиректа на callback просто не
 * происходит. Единственное рабочее лекарство — открыть ту же ссылку на
 * телефоне, где приложение уже залогинено: тогда пароль не спрашивают вовсе.
 */
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, Smartphone } from "lucide-react";

/**
 * QR текущей ссылки-приглашения. Скрыт на телефонах: там сканировать нечем и
 * незачем — страница уже открыта на нужном устройстве.
 */
export function ConnectQrCard({ url }: { url: string }) {
  return (
    <div className="hidden rounded-2xl border bg-card p-5 shadow-sm md:block">
      <div className="flex items-start gap-4">
        <div className="shrink-0 rounded-xl bg-white p-2.5">
          <QRCodeSVG value={url} size={116} level="M" data-qr-url={url} />
        </div>
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Smartphone className="h-4 w-4 text-primary" />
            Лучше открыть на телефоне
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Отсканируйте код камерой телефона, в котором вы уже вошли в свой аккаунт.
            Тогда площадка не будет спрашивать пароль — и не примет вход за попытку взлома.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            На компьютере вход просят подтвердить паролем, и Instagram часто блокирует такую
            попытку — особенно если включён VPN.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Что делать, если площадка уже показала «Мы заблокировали попытку входа». */
export function ConnectBlockedHelp() {
  return (
    <details className="group rounded-2xl border bg-card px-5 py-4 shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        Площадка заблокировала вход?
        <span className="ml-auto text-xs font-normal text-muted-foreground group-open:hidden">Открыть</span>
      </summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          Откройте приложение Instagram и подтвердите <span className="font-medium text-foreground">«Это был я»</span> в
          уведомлении о входе. То же самое лежит в Настройках: Центр аккаунтов → Пароль и безопасность → Входы в аккаунт.
        </li>
        <li>
          Выключите VPN. Вход из чужой страны площадка считает захватом аккаунта и блокирует его снова и снова.
        </li>
        <li>
          Откройте эту же ссылку на телефоне, где вы уже вошли в приложение, и повторите подключение.
        </li>
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        Менять пароль не нужно, если вход выполняли вы сами.
      </p>
    </details>
  );
}
