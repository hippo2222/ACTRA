---



\## 1. Старт и подготовка теста



\- \*\*Загрузка данных теста\*\*  

&nbsp; - Поддерживаются два формата:

&nbsp;   - `test\_data\["questions"]` (старый).

&nbsp;   - `test\_data\["content"]\["questions"]` + `content.test\_type`, `content.mode`, `content.requires\_text\_input`, `content.show\_options` (новый).

&nbsp; - `test\_type` на уровне теста: `single\_choice` / `multiple\_choice`.



\- \*\*Определение типа вопроса\*\* (\[\_get\_question\_test\_type](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:165:4-204:29)):

&nbsp; - 1) если в вопросе есть `question\["test\_type"]` – использовать его;

&nbsp; - 2) иначе считать по количеству `answers\[].correct`:

&nbsp;   - >1 → `multiple\_choice`;

&nbsp;   - =1 → `single\_choice`;

&nbsp; - 3) fallback – общий `test\_type` теста.



\- \*\*Фильтрация количества и порядка вопросов\*\*:

&nbsp; - Настройка `questions\_order == "Случайный"`:

&nbsp;   - перемешивает список вопросов.

&nbsp; - Настройка `questions\_range == "Количество"`:

&nbsp;   - обрезает список до `questions\_count`.



\- \*\*Перемешивание ответов\*\*:

&nbsp; - Флаг `shuffle\_answers` (по умолчанию True, берётся из `test\_settings`).

&nbsp; - Перемешивание делается ОДИН РАЗ:

&nbsp;   - для каждого вопроса создаётся `question\["shuffled\_answers"]`;

&nbsp;   - оригинальный список `answers` не трогается;

&nbsp;   - дальнейшая логика всегда опирается на `shuffled\_answers` для UI и возвращает к оригинальным индексам/тексте для оценки.



\- \*\*Привязка теста к файловой системе\*\*:

&nbsp; - Вычисляется `task\_dir` (по `meta.module` / `meta.topic` / `meta.id` или по `task` объекту), чтобы:

&nbsp;   - корректно резолвить относительные пути к изображениям;

&nbsp;   - эта инфа важна для UI (показ картинок вопроса).



---



\## 2. Структура экрана и навигация



\- \*\*Основные зоны\*\*:

&nbsp; - `header\_frame` – заголовок теста / панели итерации (в режиме комплекса).

&nbsp; - `main\_content\_frame` – карточка вопроса, ответы, доп. инфа.

&nbsp; - `sidebar\_frame` – панель списка вопросов (`question\_buttons`, статистика).

&nbsp; - В режиме комплекса добавляется `iteration\_panel` (информация о текущей итерации: номер, текущий/всего, сложность).



\- \*\*Навигация по вопросам\*\*:

&nbsp; - Кнопки:

&nbsp;   - `prev\_btn` – предыдущий вопрос.

&nbsp;   - `next\_btn` – следующий вопрос.

&nbsp; - Мышью:

&nbsp;   - клики по `question\_buttons`/ячейкам в боковой панели.

&nbsp; - Клавиатура:

&nbsp;   - горячие клавиши, привязанные в \[bind\_keyboard\_shortcuts](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_interface.py:780:4-796:12):

&nbsp;     - цифры/буквы для выбора ответа (\[select\_answer\_by\_key](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:373:4-388:64) / \[select\_answer\_by\_index](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:390:4-403:53));

&nbsp;     - стрелки/строки для \[prev\_question](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:310:4-318:60)/\[next\_question](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:320:4-371:190);

&nbsp;     - возможно, ESC для выхода/отмены (обработчик прописан в адаптере).



\- \*\*Состояние навигации\*\*:

&nbsp; - `current\_question\_index` хранится и в \[TestInterface](cci:2://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_interface.py:17:0-5542:51), и в \[TestExecutor](cci:2://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:41:0-1347:32), синхронизируется при переходах.

&nbsp; - В боковой панели подсветка текущего вопроса (цифра с выделением).



---



\## 3. Ответы пользователя



\- \*\*Структура хранения\*\*:

&nbsp; - В `TestExecutor.user\_answers`:

&nbsp;   - для `single\_choice` – строка текста ответа;

&nbsp;   - для `multiple\_choice` – список индексов оригинальных ответов;

&nbsp;   - для `open\_question` (mode == 'open\_question') – текст.

&nbsp; - В \[TestInterface](cci:2://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_interface.py:17:0-5542:51):

&nbsp;   - `answer\_var` (StringVar) – для single choice;

&nbsp;   - `answer\_vars\[question\_id]\[index]` (BooleanVar) – для multiple choice;

&nbsp;   - `answer\_text\_widget` – Text для open‑question.



\- \*\*Обновление ответа\*\* (\[on\_answer\_select](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:405:4-541:60)):

&nbsp; - Для open‑questions:

&nbsp;   - берёт текст из `answer\_text\_widget`, пишет в `user\_answers\[question\_id]`.

&nbsp; - Для multiple‑choice:

&nbsp;   - берёт BooleanVar’ы по `answer\_vars` → список выбранных индексов в перемешанном списке;

&nbsp;   - конвертирует их в индексы оригинального `answers`;

&nbsp;   - пишет `user\_answers\[question\_id] = \[orig\_idx...]`.

&nbsp; - Для single‑choice:

&nbsp;   - из `answer\_var` формирует `selected\_answer`;

&nbsp;   - вычисляет текст из `shuffled\_answers` и сопоставляет с оригинальным списком (чтобы записать «правильный» текст из оригинала);

&nbsp;   - записывает строку в `user\_answers\[question\_id]`.



\- \*\*Маркировка состояния вопроса\*\*:

&nbsp; - `question\_states\[question\_id] = 'answered'` после любого выбора;

&nbsp; - `marked\_questions` – отдельный set, переключаемый через \[toggle\_mark\_question](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:543:4-562:49).



\- \*\*Автосохранение\*\*:

&nbsp; - `auto\_save\_timer` + \[save\_progress](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_interface.py:5129:4-5146:104):

&nbsp;   - при каждом выборе перезапускается таймер;

&nbsp;   - через 500 мс тишины вызывает \[save\_progress](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_interface.py:5129:4-5146:104) (если реализовано).



---



\## 4. Панель вопросов (sidebar)



\- \*\*Кнопки вопросов\*\* (`question\_buttons` / grid):

&nbsp; - Для каждого вопроса:

&nbsp;   - отображает номер;

&nbsp;   - состояние:

&nbsp;     - not visited;

&nbsp;     - visited;

&nbsp;     - answered;

&nbsp;     - flagged;

&nbsp;     - в режиме review:

&nbsp;       - correct/incorrect/unanswered.

&nbsp; - При нажатии:

&nbsp;   - обновляет `current\_question\_index`;

&nbsp;   - вызывает \[show\_current\_question](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_interface.py:2333:4-3487:42) и обновляет все кнопки.



\- \*\*Фильтры/статистика\*\*:

&nbsp; - Флаги:

&nbsp;   - `filter\_answered`, `filter\_marked` (чекбоксы/триггеры в UI);

&nbsp;   - `answered\_chip`, `marked\_chip` – визуальные индикаторы количества/состояния.

&nbsp; - Методы обновления:

&nbsp;   - \[update\_sidebar\_stats](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_interface.py:4990:4-4992:12) – пересчитывает статистику по answered/marked и обновляет виджеты.

&nbsp;   - \[update\_all\_question\_buttons](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_interface.py:4825:4-4833:52) – перерисовывает все кнопки с учётом состояний (answered/correct/etc.).



---



\## 5. Проверка ответов и режимы проверки



\- \*\*Глобальная проверка (завершение теста)\*\* – \[finish\_test\_now](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:595:4-992:142):

&nbsp; - Пробегает по всем `test\_questions`:

&nbsp;   - режим `mode` (из `test\_data\['mode']`): `multiple\_choice` / `open\_question` / др.;

&nbsp;   - сложность (`difficulty\_level` из настроек) влияет на стратегию проверки для уровня 2.

&nbsp; - Для каждого вопроса:

&nbsp;   - если `open\_question`:

&nbsp;     - для уровня 2 может использовать модуль толерантности (`compare\_words\_with\_tolerance` / `\_info`);

&nbsp;     - для multiple‑open на уровне 2 парсит строку пользователя по запятым и сравнивает множества.

&nbsp;   - если `multiple\_choice`:

&nbsp;     - сравнивает множества выбранных индексов с множеством правильных;

&nbsp;   - если `single\_choice`:

&nbsp;     - сравнивает текст ответа с текстом правильного варианта.

&nbsp; - Результат:

&nbsp;   - `question\_results\[question\_id] = 'correct' | 'incorrect' | 'unanswered'`;

&nbsp;   - `correct\_answers`, `total\_questions`, `unanswered\_questions`.

&nbsp; - Показывает итог:

&nbsp;   - либо через \[interface.enter\_review\_mode(correct, total, percentage, unanswered)](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_interface.py:5472:4-5542:51);

&nbsp;   - либо через fallback \[parent.show\_test\_results\_now(...)](cci:1://file:///d:/Ai%20Ai/radioproject/desktop-app/ui/task\_renderers/test\_renderer\_adapter.py:108:4-157:51).



\- \*\*Проверка «по ходу» (immediate check)\*\*:

&nbsp; - Настройка `test\_settings\['check\_immediately']`:

&nbsp;   - в \[next\_question](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:320:4-371:190) перед переходом:

&nbsp;     - вызывает \[check\_question\_result(current\_index)](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:1104:4-1260:199);

&nbsp;     - помечает `checked\_questions\[current\_index] = True`;

&nbsp;     - обновляет боковую панель (цвета/статусы).

&nbsp; - Таким образом часть UI может показывать частичные результаты до завершения теста.



\- \*\*\[check\_question\_result](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:1104:4-1260:199)\*\* (по коду внизу файла):

&nbsp; - Проверяет ОДИН вопрос (по индексу) и заполняет `question\_results\[question\_id]` для него.

&nbsp; - Использует ту же логику, что и в \[finish\_test\_now](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:595:4-992:142), но локально.



\- \*\*Review‑режим в интерфейсе\*\* (\[enter\_review\_mode](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_interface.py:5472:4-5542:51) в TestInterface):

&nbsp; - Переводит UI в режим просмотра:

&nbsp;   - блокирует изменение ответов;

&nbsp;   - меняет внешний вид карточек ответов;

&nbsp;   - подсвечивает правильные/неправильные;

&nbsp;   - в боковой панели использует `question\_results` для цвета/иконок.

&nbsp; - Показывает сводку результатов теста (correct / total / % / unanswered).

&nbsp; - В режиме комплекса может взаимодействовать с HUD (кнопка «следующее задание» в AdaptiveSessionScreen).



---



\## 6. Таймер и HUD (особенно для комплекса)



\- \*\*Таймер теста\*\*:

&nbsp; - Настройки:

&nbsp;   - `time\_limit` (`'Ограничить'` / другое);

&nbsp;   - `time\_seconds` или `time\_minutes` (конвертация).

&nbsp; - \[start\_test\_timer](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:249:4-252:36) / \[update\_test\_timer](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:254:4-265:86):

&nbsp;   - каждую секунду обновляет `time\_limit\_seconds`;

&nbsp;   - вызывает \[update\_timer\_display](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:267:4-293:13) в интерфейсе;

&nbsp;   - по достижении нуля вызывает \[finish\_test\_by\_timeout](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:994:4-1025:34).



\- \*\*Отображение времени\*\*:

&nbsp; - `time\_label` в TestInterface:

&nbsp;   - показывает `⏱ mm:ss`;

&nbsp;   - цвет меняется в зависимости от оставшегося времени:

&nbsp;     - красный < 60 секунд;

&nbsp;     - оранжевый < 5 минут;

&nbsp;     - основной цвет в остальное время.



\- \*\*HUD комплекса\*\* (через адаптер):

&nbsp; - коллбеки `on\_question\_changed` и `on\_timer\_update` в TestInterface:

&nbsp;   - вызываются, чтобы обновлять HUD на экране `AdaptiveSessionScreen`:

&nbsp;     - текущий номер вопроса / всего;

&nbsp;     - текст таймера;

&nbsp; - после завершения теста HUD может менять доступность кнопки «Следующее задание».



---



\## 7. Клавиатурные шорткаты и UX мелочи



\- \*\*Горячие клавиши\*\* (\[bind\_keyboard\_shortcuts](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_interface.py:780:4-796:12) в TestInterface):

&nbsp; - выбор ответа по цифре/букве:

&nbsp;   - \[select\_answer\_by\_key](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:373:4-388:64) / \[select\_answer\_by\_index](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:390:4-403:53);

&nbsp; - навигация по вопросам (стрелки/Enter/Backspace – зависит от реализации).

\- \*\*Toast‑уведомления\*\* (\[show\_toast](cci:1://file:///d:/Ai%20Ai/radioproject/task\_system/ui/components/trainer/test\_executor.py:564:4-593:58) в TestExecutor):

&nbsp; - отображает временный лэйбл поверх вопроса (например, «Время вышло», «Ответ сохранён»).

\- \*\*Флаги вопросов\*\*:

&nbsp; - кнопка `mark\_btn` в интерфейсе:

&nbsp;   - добавляет/убирает вопрос в `marked\_questions`;

&nbsp;   - UI (sidebar) показывает флажок/иконку на соответствующей кнопке вопроса.



---



\## 8. Уровень сложности 1 vs 2



С точки зрения UI/логики:



\- \*\*Уровень 1\*\*:

&nbsp; - стандартная проверка без толерантности;

&nbsp; - для open‑question – точное совпадение текста/варианта.



\- \*\*Уровень 2\*\*:

&nbsp; - включает толерантность для текста:

&nbsp;   - `compare\_words\_with\_tolerance\_info`:

&nbsp;     - различает типы несовпадения (typo/ending/both/exact);

&nbsp;     - может подсвечивать «почти правильно».

&nbsp; - для множественных текстовых ответов (через запятую) сравнивает множества.



UI‑механики, завязанные на уровне 2:



\- дополнительные сообщения в `question\_tolerance\_info` (можно показывать в review);

\- возможно, иконки/цвета, отражающие «почти правильный» ответ.



---



\## Что это даёт тебе дальше



У нас теперь есть список \*\*поведенческих механик\*\*:



\- как стартует тест, как выбираются и фильтруются вопросы,

\- как хранятся ответы и как они нормализуются,

\- какие состояния есть у вопроса и на каком уровне они считаются,

\- какие есть режимы проверки (immediate / finish / review),

\- как работает таймер и HUD,

\- как выглядит навигация и панели в терминах логики.



Дальше можно:



\- взять конкретный макет (например, L1‑M1) и для каждой из этих механик решить:

&nbsp; - какие части макета её отображают (и как – цвет, иконка, подписи);

&nbsp; - какие JS‑сигналы нужны (например, `onQuestionSelect`, `onAnswerSelect`, `onCheckQuestion`, `onFinishTest`, `onToggleFlag`, `onTimerTick`).

\- потом уже \*\*подстраивать TestUI/web‑слой под эти механики\*\*, а не наоборот.

