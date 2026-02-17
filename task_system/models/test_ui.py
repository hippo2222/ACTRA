"""
UI компоненты для тестовых заданий
"""

import tkinter as tk
from tkinter import ttk, messagebox, filedialog
from typing import List, Dict, Any, Callable, Optional
import os
import logging

logger = logging.getLogger(__name__)
from .test_task import TestTask, TestQuestion, TestAnswer, TestSettings


class TestQuestionEditor:
    """Редактор отдельного вопроса теста"""
    
    def __init__(self, parent, question: Optional[TestQuestion] = None, 
                 test_type: str = 'single_choice', on_save: Optional[Callable] = None,
                 on_cancel: Optional[Callable] = None):
        self.parent = parent
        self.question = question
        self.test_type = test_type
        self.on_save = on_save
        self.on_cancel = on_cancel
        self.answers = []
        self.answers_canvas = None  # Будет создан в create_ui
        self.answers_scrollbar = None  # Будет создан в create_ui
        self.images = []  # Список путей к изображениям (до 3 шт)
        self.images_frame = None  # Фрейм для отображения миниатюр
        
        self.create_ui()
        if question:
            self.load_question()
    
    def _on_answers_mousewheel(self, event):
        """Обработчик прокрутки колесом мыши для области ответов"""
        widget = event.widget
        widget_class = widget.winfo_class() if hasattr(widget, 'winfo_class') else "unknown"
        widget_path = str(widget) if hasattr(widget, '__str__') else "unknown"
        logger.info(f"[TestQuestionEditor._on_answers_mousewheel] Метод вызван для: {widget_path} (класс: {widget_class}), delta={event.delta}")
        
        if self.answers_canvas:
            # Прокручиваем Canvas
            self.answers_canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
            logger.info(f"[TestQuestionEditor._on_answers_mousewheel] Canvas прокручен, возвращаем 'break'")
        else:
            logger.warning(f"[TestQuestionEditor._on_answers_mousewheel] answers_canvas не существует!")
        # КРИТИЧЕСКИ ВАЖНО: всегда возвращаем "break" для предотвращения обработки виджетом
        return "break"
    
    def create_ui(self):
        """Создает интерфейс редактора вопроса"""
        self.frame = tk.Frame(self.parent)
        
        # Создаем прокручиваемую область для всего редактора
        self.main_canvas = tk.Canvas(self.frame, highlightthickness=0)
        self.main_scrollbar = tk.Scrollbar(self.frame, orient="vertical", command=self.main_canvas.yview)
        
        # Внутренний фрейм для контента
        self.content_frame = tk.Frame(self.main_canvas)
        
        # Размещаем Canvas и Scrollbar
        self.main_canvas.pack(side="left", fill="both", expand=True)
        self.main_scrollbar.pack(side="right", fill="y")
        
        # Настраиваем прокрутку
        self.main_canvas.configure(yscrollcommand=self.main_scrollbar.set)
        self.main_canvas_window = self.main_canvas.create_window((0, 0), window=self.content_frame, anchor="nw")
        
        # Обновление ширины и области прокрутки
        def configure_canvas(event):
            self.main_canvas.itemconfig(self.main_canvas_window, width=event.width)
            
        self.main_canvas.bind('<Configure>', configure_canvas)
        
        def configure_frame(event):
            self.main_canvas.configure(scrollregion=self.main_canvas.bbox("all"))
            
        self.content_frame.bind('<Configure>', configure_frame)
        
        # Прокрутка колесом мыши для всего редактора
        def on_main_mousewheel(event):
            self.main_canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
            return "break"
            
        # Привязываем прокрутку к canvas и content_frame
        self.main_canvas.bind("<MouseWheel>", on_main_mousewheel)
        self.content_frame.bind("<MouseWheel>", on_main_mousewheel)

        # Текст вопроса - упаковываем сверху
        tk.Label(self.content_frame, text="Текст вопроса:").pack(anchor="w", pady=(0, 5), side="top")
        self.question_text = tk.Text(self.content_frame, height=2, width=50)  # Уменьшена высота с 3 до 2 для экономии места
        self.question_text.pack(fill="x", expand=False, pady=(0, 10), side="top")  # Добавлен expand=False и side="top"
        
        # Изображение вопроса (для image_choice)
        if self.test_type == 'image_choice':
            self.image_frame = tk.Frame(self.content_frame)
            self.image_frame.pack(fill="x", pady=(0, 10))
            
            tk.Label(self.image_frame, text="Изображение вопроса (старый формат):").pack(anchor="w")
            self.question_image_path = tk.StringVar()
            self.question_image_entry = tk.Entry(self.image_frame, textvariable=self.question_image_path, width=40)
            self.question_image_entry.pack(side="left", fill="x", expand=True, padx=(0, 5))
            tk.Button(self.image_frame, text="Выбрать", 
                     command=self.select_question_image).pack(side="right")
        
        # Новые изображения вопроса (до 3 шт)
        self._create_images_ui()
        
        
        # Варианты ответов - упаковываем сверху
        tk.Label(self.content_frame, text="Варианты ответов:").pack(anchor="w", pady=(0, 5), side="top")
        
        # Создаем контейнер для прокручиваемой области с ответами
        # Ограничиваем высоту, чтобы кнопки управления всегда были видны
        answers_container = tk.Frame(self.content_frame)
        
        # Устанавливаем фиксированную высоту ДО pack, чтобы контейнер не занимал все пространство
        answers_container.pack_propagate(False)
        answers_container.configure(height=130)  # Баланс между местом для ответов и видимостью кнопок
        
        # Используем fill="both", но expand=False, чтобы контейнер не расширялся вертикально
        answers_container.pack(fill="both", expand=False, pady=(0, 10), side="top")
        
        # Canvas для прокрутки
        self.answers_canvas = tk.Canvas(answers_container, highlightthickness=0)
        self.answers_scrollbar = tk.Scrollbar(answers_container, orient="vertical", command=self.answers_canvas.yview)
        
        # Внутренний фрейм для ответов (размещается в Canvas)
        self.answers_frame = tk.Frame(self.answers_canvas)
        
        # Создаем окно в Canvas для внутреннего фрейма
        self.answers_canvas_window = self.answers_canvas.create_window((0, 0), window=self.answers_frame, anchor="nw")
        
        # Настраиваем скроллбар
        self.answers_canvas.configure(yscrollcommand=self.answers_scrollbar.set)
        
        # Размещаем Canvas и Scrollbar
        self.answers_canvas.pack(side="left", fill="both", expand=True)
        self.answers_scrollbar.pack(side="right", fill="y")
        
        # Убеждаемся, что Canvas не превышает высоту контейнера
        # (это должно работать автоматически через pack_propagate(False) контейнера)
        
        # Настраиваем обновление ширины внутреннего фрейма при изменении размера canvas
        def configure_canvas_width(event):
            canvas_width = event.width
            self.answers_canvas.itemconfig(self.answers_canvas_window, width=canvas_width)
        
        self.answers_canvas.bind('<Configure>', configure_canvas_width)
        
        # Настраиваем обновление области прокрутки при изменении содержимого
        def configure_scroll_region(event=None):
            self.answers_canvas.update_idletasks()
            self.answers_canvas.config(scrollregion=self.answers_canvas.bbox("all"))
        
        self.answers_frame.bind('<Configure>', configure_scroll_region)
        
        # Добавляем прокрутку колесом мыши
        def on_mousewheel(event):
            # ОТЛАДКА: логируем событие прокрутки
            widget = event.widget
            widget_class = widget.winfo_class() if hasattr(widget, 'winfo_class') else "unknown"
            widget_path = str(widget) if hasattr(widget, '__str__') else "unknown"
            logger.info(f"[TestQuestionEditor.on_mousewheel] Прокрутка на виджете: {widget_path} (класс: {widget_class}), delta={event.delta}")
            
            # Прокручиваем Canvas
            self.answers_canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
            logger.info(f"[TestQuestionEditor.on_mousewheel] Canvas прокручен, возвращаем 'break'")
            return "break"  # КРИТИЧЕСКИ ВАЖНО: предотвращаем дальнейшую обработку события
        
        # Обертка для гарантированного возврата "break"
        def mousewheel_wrapper(event):
            widget = event.widget
            widget_class = widget.winfo_class() if hasattr(widget, 'winfo_class') else "unknown"
            widget_path = str(widget) if hasattr(widget, '__str__') else "unknown"
            logger.info(f"[TestQuestionEditor.mousewheel_wrapper] ОБЕРТКА вызвана для: {widget_path} (класс: {widget_class})")
            result = on_mousewheel(event)
            logger.info(f"[TestQuestionEditor.mousewheel_wrapper] ОБЕРТКА возвращает: {result}")
            return result if result else "break"
        
        # Привязываем прокрутку колесом мыши к Canvas
        logger.info(f"[TestQuestionEditor.create_ui] Привязка прокрутки к Canvas: {self.answers_canvas}")
        self.answers_canvas.bind("<MouseWheel>", mousewheel_wrapper)
        self.answers_canvas.bind("<Button-4>", lambda e: self.answers_canvas.yview_scroll(-1, "units") or "break")  # Linux
        self.answers_canvas.bind("<Button-5>", lambda e: self.answers_canvas.yview_scroll(1, "units") or "break")  # Linux
        
        # Привязываем к внутреннему фрейму с возвратом "break"
        logger.info(f"[TestQuestionEditor.create_ui] Привязка прокрутки к answers_frame: {self.answers_frame}")
        self.answers_frame.bind("<MouseWheel>", mousewheel_wrapper)
        self.answers_frame.bind("<Button-4>", lambda e: self.answers_canvas.yview_scroll(-1, "units") or "break")
        self.answers_frame.bind("<Button-5>", lambda e: self.answers_canvas.yview_scroll(1, "units") or "break")
        
        # Привязываем прокрутку к контейнеру answers_container
        logger.info(f"[TestQuestionEditor.create_ui] Привязка прокрутки к answers_container: {answers_container}")
        answers_container.bind("<MouseWheel>", mousewheel_wrapper)
        answers_container.bind("<Button-4>", lambda e: self.answers_canvas.yview_scroll(-1, "units") or "break")
        answers_container.bind("<Button-5>", lambda e: self.answers_canvas.yview_scroll(1, "units") or "break")
        
        # Сохраняем mousewheel_wrapper для использования в add_answer
        self._mousewheel_wrapper = mousewheel_wrapper
        
        # Кнопки управления
        buttons_frame = tk.Frame(self.content_frame)
        
        add_button = tk.Button(buttons_frame, text="Добавить ответ", 
                 command=self.add_answer)
        add_button.pack(side="left", padx=(0, 5))
        
        save_button = tk.Button(buttons_frame, text="Сохранить", 
                 command=self.save_question)
        save_button.pack(side="left", padx=(0, 5))
        
        cancel_button = tk.Button(buttons_frame, text="Отмена", 
                 command=self.cancel)
        cancel_button.pack(side="left")
        
        # Упаковываем кнопки сверху (после answers_container)
        buttons_frame.pack(fill="x", expand=False, pady=(10, 0), side="top")
        
        # Привязываем прокрутку ко всем виджетам рекурсивно
        self._bind_mousewheel_recursive(self.content_frame)
        
        # Финализация настройки UI
        self.frame.update_idletasks()
    
    def _bind_mousewheel_recursive(self, widget):
        """Рекурсивно привязывает прокрутку колесом мыши к виджету и его дочерним элементам"""
        # Проверяем, существует ли виджет
        try:
            if not widget.winfo_exists():
                return
        except Exception:
            return

        widget_class = widget.winfo_class()
        
        # Привязываем событие <MouseWheel>
        # Используем 'add=+' чтобы не перетирать существующие биндинги, если они есть
        # Но для Text и Entry нам НАДО перехватить событие, поэтому для них можно без '+' или с return 'break'
        
        # Используем сохраненный wrapper
        if hasattr(self, '_mousewheel_wrapper'):
            # Биндим на само событие
            widget.bind("<MouseWheel>", self._mousewheel_wrapper, add="+")
            widget.bind("<Button-4>", self._mousewheel_wrapper, add="+")
            widget.bind("<Button-5>", self._mousewheel_wrapper, add="+")
        
        # Рекурсивно для детей
        for child in widget.winfo_children():
            self._bind_mousewheel_recursive(child)

    def add_answer(self):
        """Добавляет новый вариант ответа"""
        answer_frame = tk.Frame(self.answers_frame)
        answer_frame.pack(fill="x", pady=2)
        
        # Привязываем прокрутку к новому фрейму ответа и всем его будущим детям
        # Важно: вызываем это ПОСЛЕ создания всех виджетов в ответе, поэтому переносим вызов в конец метода

        
        # Всегда используем чекбоксы для выбора правильности ответа
        # Это позволяет легко отменить правильность ответа
        correct_var = tk.BooleanVar()
        correct_widget = tk.Checkbutton(answer_frame, variable=correct_var)
        correct_widget.pack(side="left", padx=(0, 5))
        
        # Текст ответа
        answer_text = tk.Text(answer_frame, height=1, width=30)
        answer_text.pack(side="left", fill="x", expand=True, padx=(0, 5))
        
        # Изображение ответа (доступно для всех типов тестов)
        answer_image_path = tk.StringVar()
        answer_image_label = tk.Label(answer_frame, text="Нет изображения", fg="gray", width=15)
        answer_image_label.pack(side="left", padx=(0, 5))
        
        # Фрейм для кнопок управления изображением
        image_buttons_frame = tk.Frame(answer_frame)
        image_buttons_frame.pack(side="left", padx=(0, 5))
        
        def update_image_label():
            """Обновляет метку изображения"""
            if answer_image_path.get():
                filename = os.path.basename(answer_image_path.get())
                answer_image_label.config(text=f"🖼️ {filename[:15]}...", fg="green")
            else:
                answer_image_label.config(text="Нет изображения", fg="gray")
        
        def select_image():
            """Выбирает изображение для ответа"""
            file_path = filedialog.askopenfilename(
                title="Выберите изображение для варианта ответа",
                filetypes=[
                    ("Изображения", "*.jpg *.jpeg *.png *.gif *.bmp *.tiff"),
                    ("JPEG", "*.jpg *.jpeg"),
                    ("PNG", "*.png"),
                    ("Все файлы", "*.*")
                ]
            )
            if file_path:
                answer_image_path.set(file_path)
                update_image_label()
        
        def remove_image():
            """Удаляет изображение из варианта ответа"""
            if answer_image_path.get():
                if messagebox.askyesno("Подтверждение", "Удалить изображение из этого варианта ответа?"):
                    answer_image_path.set("")
                    update_image_label()
            else:
                messagebox.showinfo("Информация", "У этого варианта ответа нет изображения")
        
        tk.Button(image_buttons_frame, text="Добавить", 
                 command=select_image, width=8).pack(side="left", padx=(0, 2))
        tk.Button(image_buttons_frame, text="Удалить", 
                 command=remove_image, width=8).pack(side="left")
        
        # Кнопка удаления варианта ответа
        tk.Button(answer_frame, text="Удалить", 
                 command=lambda: self.remove_answer(answer_frame)).pack(side="right")
        
        # Привязываем прокрутку ко всем виджетам в answer_frame рекурсивно
        self._bind_mousewheel_recursive(answer_frame)
        
        # Сохраняем данные ответа
        answer_data = {
            'frame': answer_frame,
            'correct_var': correct_var,
            'text_widget': answer_text,
            'image_path': answer_image_path,
            'image_label': answer_image_label,
            'update_image_label': update_image_label
        }
        self.answers.append(answer_data)
        
        # Обновляем область прокрутки после добавления нового ответа
        if self.answers_canvas:
            self.answers_canvas.update_idletasks()
            self.answers_canvas.config(scrollregion=self.answers_canvas.bbox("all"))
    
    def remove_answer(self, answer_frame):
        """Удаляет вариант ответа"""
        for i, answer_data in enumerate(self.answers):
            if answer_data['frame'] == answer_frame:
                self.answers.pop(i)
                answer_frame.destroy()
                # Обновляем область прокрутки после удаления
                if self.answers_canvas:
                    self.answers_canvas.update_idletasks()
                    self.answers_canvas.config(scrollregion=self.answers_canvas.bbox("all"))
                break
    
    def update_correct_answers(self):
        """Обновляет правильные ответы"""
        # Метод больше не нужен, так как используем чекбоксы вместо радиокнопок
        # Оставлен для обратной совместимости, но не выполняет никаких действий
        pass
    
    def select_question_image(self):
        """Выбирает изображение для вопроса"""
        file_path = filedialog.askopenfilename(
            title="Выберите изображение",
            filetypes=[("Изображения", "*.png *.jpg *.jpeg *.gif *.bmp")]
        )
        if file_path:
            self.question_image_path.set(file_path)
    
    def _create_images_ui(self):
        """Создает UI для управления изображениями вопроса"""
        images_container = tk.Frame(self.content_frame)
        images_container.pack(fill="x", pady=(0, 10), side="top")
        
        header_frame = tk.Frame(images_container)
        header_frame.pack(fill="x", pady=(0, 5))
        
        tk.Label(header_frame, text="Изображения (макс 3):").pack(side="left")
        
        self.add_image_btn = tk.Button(header_frame, text="Добавить фото", 
                                      command=self.add_question_image,
                                      font=("Arial", 9))
        self.add_image_btn.pack(side="left", padx=10)
        
        # Фрейм для миниатюр
        self.images_frame = tk.Frame(images_container)
        self.images_frame.pack(fill="x", pady=5)
    
    def add_question_image(self):
        """Добавляет изображение к вопросу"""
        if len(self.images) >= 3:
            messagebox.showwarning("Лимит изображений", "Максимум 3 изображения на вопрос")
            return
            
        file_paths = filedialog.askopenfilenames(
            title="Выберите изображения",
            filetypes=[("Изображения", "*.png *.jpg *.jpeg *.gif *.bmp")]
        )
        
        if file_paths:
            added_count = 0
            for path in file_paths:
                if len(self.images) < 3:
                    self.images.append(path)
                    added_count += 1
            
            if added_count > 0:
                self.update_images_ui()
    
    def remove_question_image(self, index):
        """Удаляет изображение по индексу"""
        if 0 <= index < len(self.images):
            self.images.pop(index)
            self.update_images_ui()
            
    def update_images_ui(self):
        """Обновляет отображение списка изображений"""
        # Очищаем текущие миниатюры
        for widget in self.images_frame.winfo_children():
            widget.destroy()
            
        for i, img_path in enumerate(self.images):
            frame = tk.Frame(self.images_frame, relief="solid", bd=1)
            frame.pack(side="left", padx=5, pady=2)
            
            # Имя файла
            filename = os.path.basename(img_path)
            if len(filename) > 15:
                filename = filename[:12] + "..."
            
            tk.Label(frame, text=f"IMG {i+1}", font=("Arial", 8, "bold")).pack(anchor="w", padx=2)
            tk.Label(frame, text=filename, font=("Arial", 8)).pack(anchor="w", padx=2)
            
            # Кнопка удаления
            tk.Button(frame, text="❌", command=lambda idx=i: self.remove_question_image(idx),
                     font=("Arial", 8), bg="#ffcccc", activebackground="#ffaaaa",
                     relief="flat", width=3).pack(fill="x", padx=1, pady=1)
        
        # Обновляем состояние кнопки добавления
        if len(self.images) >= 3:
            self.add_image_btn.config(state="disabled")
        else:
            self.add_image_btn.config(state="normal")

    
    def select_answer_image(self, image_path_var):
        """Выбирает изображение для ответа"""
        file_path = filedialog.askopenfilename(
            title="Выберите изображение",
            filetypes=[("Изображения", "*.png *.jpg *.jpeg *.gif *.bmp")]
        )
        if file_path:
            image_path_var.set(file_path)
    
    def load_question(self):
        """Загружает данные вопроса в интерфейс"""
        if not self.question:
            return
        
        self.question_text.delete("1.0", tk.END)
        self.question_text.insert("1.0", self.question.text)
        
        if self.test_type == 'image_choice' and self.question.image_path:
            self.question_image_path.set(self.question.image_path)
        
        # Загружаем список изображений
        if self.question.images:
            self.images = self.question.images.copy()  # Копируем список
            self.update_images_ui()

        
        # Загружаем варианты ответов
        for answer in self.question.answers:
            self.add_answer()
            answer_data = self.answers[-1]
            answer_data['text_widget'].insert("1.0", answer.text)
            answer_data['correct_var'].set(answer.correct)
            # Загружаем изображение для всех типов тестов
            if answer.image_path:
                answer_data['image_path'].set(answer.image_path)
                answer_data['update_image_label']()
            
            # Обработчики прокрутки уже привязаны в add_answer, но убеждаемся что они есть
            if hasattr(self, '_mousewheel_wrapper'):
                answer_data['text_widget'].bind("<MouseWheel>", self._mousewheel_wrapper, add="+")
                logger.info(f"[TestQuestionEditor.load_question] Прокрутка привязана к загруженному Text виджету: {answer_data['text_widget']}")
        
        # Обновляем область прокрутки после загрузки вопросов
        if self.answers_canvas:
            self.answers_canvas.update_idletasks()
            self.answers_canvas.config(scrollregion=self.answers_canvas.bbox("all"))
    
    def save_question(self):
        """Сохраняет вопрос"""
        question_text = self.question_text.get("1.0", tk.END).strip()
        if not question_text:
            messagebox.showerror("Ошибка", "Введите текст вопроса")
            return
        
        if not self.answers:
            messagebox.showerror("Ошибка", "Добавьте хотя бы один вариант ответа")
            return
        
        # Проверяем правильные ответы
        correct_answers = [a for a in self.answers if a['correct_var'].get()]
        if not correct_answers:
            messagebox.showerror("Ошибка", "Выберите хотя бы один правильный ответ")
            return
        
        # УБРАНО автоматическое определение типа теста
        # Каждый вопрос может иметь разное количество правильных ответов
        # Тип теста больше не важен - валидация не требуется
        
        # Создаем объект вопроса
        answers = []
        for answer_data in self.answers:
            text = answer_data['text_widget'].get("1.0", tk.END).strip()
            # Получаем путь к изображению (для всех типов тестов)
            image_path = answer_data['image_path'].get() if answer_data['image_path'].get() else None
            
            # Вариант ответа валиден, если есть текст ИЛИ изображение
            if text or image_path:
                answer = TestAnswer(
                    text=text or "",  # Если текста нет, используем пустую строку
                    correct=answer_data['correct_var'].get(),
                    image_path=image_path
                )
                answers.append(answer)
        
        if not answers:
            messagebox.showerror("Ошибка", "Добавьте хотя бы один вариант ответа")
            return
        
        question = TestQuestion(
            id=self.question.id if self.question else 0,
            text=question_text,
            answers=answers,
            image_path=self.question_image_path.get() if self.test_type == 'image_choice' else None,
            images=self.images if self.images else None  # Сохраняем список изображений
        )
        
        if self.on_save:
            self.on_save(question)
        
        self.frame.destroy()
    
    def cancel(self):
        """Отменяет редактирование"""
        if self.on_cancel:
            self.on_cancel()
        self.frame.destroy()


class TestListEditor:
    """Редактор списка вопросов теста"""
    
    def __init__(self, parent, test_task: TestTask, on_save: Optional[Callable] = None,
                 show_control_buttons: bool = True, question_editor_parent: Optional[tk.Widget] = None,
                 on_question_editor_closed: Optional[Callable] = None):
        self.parent = parent
        self.test_task = test_task
        self.on_save = on_save
        self.show_control_buttons = show_control_buttons
        self.question_editor_parent = question_editor_parent or parent
        self.on_question_editor_closed = on_question_editor_closed
        
        self.create_ui()
        self.refresh_questions()
    
    def create_ui(self):
        """Создает интерфейс списка вопросов"""
        self.frame = tk.Frame(self.parent)
        
        # Заголовок
        header_frame = tk.Frame(self.frame)
        header_frame.pack(fill="x", pady=(0, 10))
        
        self.header_label = tk.Label(header_frame, text=f"Вопросы теста ({self.test_task.get_question_count()})", 
                font=("Arial", 12, "bold"))
        self.header_label.pack(side="left")
        
        # Кнопки управления (показываются только если show_control_buttons=True)
        if self.show_control_buttons:
            buttons_frame = tk.Frame(header_frame)
            buttons_frame.pack(side="right")
            
            tk.Button(buttons_frame, text="Добавить вопрос", 
                     command=self.add_question).pack(side="left", padx=(0, 5))
            tk.Button(buttons_frame, text="Импорт из файла", 
                     command=self.import_questions).pack(side="left", padx=(0, 5))
            tk.Button(buttons_frame, text="Сохранить тест", 
                     command=self.save_test).pack(side="left")
        
        # Список вопросов
        self.questions_frame = tk.Frame(self.frame)
        self.questions_frame.pack(fill="both", expand=True)
        
        # Скроллбар для списка вопросов
        self.scrollbar = tk.Scrollbar(self.questions_frame)
        self.scrollbar.pack(side="right", fill="y")
        
        self.questions_canvas = tk.Canvas(self.questions_frame, yscrollcommand=self.scrollbar.set)
        self.questions_canvas.pack(side="left", fill="both", expand=True)
        
        self.scrollbar.config(command=self.questions_canvas.yview)
        
        # Внутренний фрейм для вопросов
        self.questions_inner = tk.Frame(self.questions_canvas)
        self.questions_canvas_window = self.questions_canvas.create_window((0, 0), window=self.questions_inner, anchor="nw")
        
        # Настраиваем обновление ширины внутреннего фрейма при изменении размера canvas
        def configure_canvas_width(event):
            canvas_width = event.width
            self.questions_canvas.itemconfig(self.questions_canvas_window, width=canvas_width)
        
        self.questions_canvas.bind('<Configure>', configure_canvas_width)
    
    def refresh_questions(self):
        """Обновляет список вопросов"""
        # Обновляем заголовок с количеством вопросов
        if hasattr(self, 'header_label'):
            self.header_label.config(text=f"Вопросы теста ({self.test_task.get_question_count()})")
        
        # Очищаем существующие виджеты
        for widget in self.questions_inner.winfo_children():
            widget.destroy()
        
        # Создаем виджеты для каждого вопроса
        for i, question in enumerate(self.test_task.questions):
            self.create_question_widget(question, i)
        
        # Обновляем скроллбар и ширину внутреннего фрейма
        self.questions_inner.update_idletasks()
        canvas_width = self.questions_canvas.winfo_width()
        if canvas_width > 1:  # Проверяем, что canvas уже отрисован
            self.questions_canvas.itemconfig(self.questions_canvas_window, width=canvas_width)
        self.questions_canvas.config(scrollregion=self.questions_canvas.bbox("all"))
    
    def create_question_widget(self, question: TestQuestion, index: int):
        """Создает виджет для отображения вопроса"""
        question_frame = tk.Frame(self.questions_inner, relief="raised", bd=1)
        question_frame.pack(fill="x", pady=2, padx=0)
        
        # Номер и текст вопроса (кликабельная область)
        info_frame = tk.Frame(question_frame, cursor="hand2", bg="SystemButtonFace")
        info_frame.pack(fill="x", expand=True, pady=5, padx=2)
        
        # Делаем info_frame кликабельным для редактирования
        def on_question_click(e):
            self.edit_question(question)
        
        def on_enter(e):
            info_frame.config(bg="#e0e0e0")
        
        def on_leave(e):
            info_frame.config(bg="SystemButtonFace")
        
        info_frame.bind("<Button-1>", on_question_click)
        info_frame.bind("<Enter>", on_enter)
        info_frame.bind("<Leave>", on_leave)
        
        question_label = tk.Label(info_frame, text=f"Вопрос {index + 1}:", 
                font=("Arial", 10, "bold"), cursor="hand2", bg=info_frame.cget("bg"))
        question_label.pack(side="left")
        question_label.bind("<Button-1>", on_question_click)
        question_label.bind("<Enter>", lambda e: on_enter(e))
        question_label.bind("<Leave>", lambda e: on_leave(e))
        
        # Обрезаем длинный текст, чтобы было место для счетчика правильных ответов
        # Используем 30 символов как максимум, чтобы гарантировать место для счетчика
        max_length = 30
        display_text = question.text[:max_length] + "..." if len(question.text) > max_length else question.text
        text_label = tk.Label(info_frame, text=display_text, cursor="hand2", bg=info_frame.cget("bg"))
        text_label.pack(side="left", padx=(10, 0))
        text_label.bind("<Button-1>", on_question_click)
        text_label.bind("<Enter>", lambda e: on_enter(e))
        text_label.bind("<Leave>", lambda e: on_leave(e))
        
        # Количество правильных ответов (сокращенный формат для экономии места)
        correct_count = sum(1 for a in question.answers if a.correct)
        correct_label = tk.Label(info_frame, text=f"✓ {correct_count}/{len(question.answers)}", 
                fg="green", cursor="hand2", bg=info_frame.cget("bg"))
        correct_label.pack(side="right", padx=(5, 0))
        correct_label.bind("<Button-1>", on_question_click)
        correct_label.bind("<Enter>", lambda e: on_enter(e))
        correct_label.bind("<Leave>", lambda e: on_leave(e))
        
        # Кнопка удаления
        buttons_frame = tk.Frame(question_frame)
        buttons_frame.pack(fill="x", expand=True, pady=(0, 5), padx=2)
        
        tk.Button(buttons_frame, text="Удалить", 
                 command=lambda: self.delete_question(question)).pack(side="left")
    
    def add_question(self):
        """Добавляет новый вопрос"""
        question = TestQuestion(id=len(self.test_task.questions), text="", answers=[])
        self.test_task.questions.append(question)
        self.refresh_questions()
        self.edit_question(question)
    
    def edit_question(self, question: TestQuestion):
        """Редактирует вопрос"""
        logger.info(f"[TestListEditor.edit_question] НАЧАЛО: Редактирование вопроса {question.id}")
        logger.info(f"[TestListEditor.edit_question] question_editor_parent: {self.question_editor_parent}")
        logger.info(f"[TestListEditor.edit_question] Размеры question_editor_parent ДО очистки: width={self.question_editor_parent.winfo_width()}, height={self.question_editor_parent.winfo_height()}")
        
        # Очищаем родительский контейнер перед созданием редактора
        widgets_before = len(self.question_editor_parent.winfo_children())
        logger.info(f"[TestListEditor.edit_question] Виджетов в question_editor_parent ДО очистки: {widgets_before}")
        for widget in self.question_editor_parent.winfo_children():
            logger.debug(f"[TestListEditor.edit_question] Удаление виджета: {widget}")
            widget.destroy()
        widgets_after = len(self.question_editor_parent.winfo_children())
        logger.info(f"[TestListEditor.edit_question] Виджетов в question_editor_parent ПОСЛЕ очистки: {widgets_after}")
        
        # Используем актуальный test_type из test_task
        current_test_type = getattr(self.test_task, 'test_type', 'single_choice')
        logger.info(f"[TestListEditor.edit_question] Создание TestQuestionEditor с test_type={current_test_type}")
        
        try:
            editor = TestQuestionEditor(
                self.question_editor_parent, question, current_test_type, 
                lambda q: self.on_question_saved(q),
                on_cancel=self.on_question_editor_closed
            )
            logger.info(f"[TestListEditor.edit_question] TestQuestionEditor создан успешно: {editor}")
            logger.info(f"[TestListEditor.edit_question] editor.frame: {editor.frame}")
        except Exception as e:
            logger.exception(f"[TestListEditor.edit_question] ОШИБКА при создании TestQuestionEditor: {e}")
            raise
        
        # Сохраняем ссылку на test_task для получения актуального типа
        if hasattr(editor, 'parent'):
            editor._test_task_ref = self.test_task
        
        # Упаковка editor.frame с fill=tk.BOTH, expand=True (для работы скроллинга)
        try:
            editor.frame.pack(fill=tk.BOTH, expand=True)
            editor.frame.update_idletasks()
        except Exception as e:
            logger.exception(f"[TestListEditor.edit_question] ОШИБКА при упаковке editor.frame: {e}")
            raise
    
    def delete_question(self, question: TestQuestion):
        """Удаляет вопрос"""
        if messagebox.askyesno("Подтверждение", "Удалить этот вопрос?"):
            self.test_task.questions.remove(question)
            self.refresh_questions()
    
    def on_question_saved(self, question: TestQuestion):
        """Обработчик сохранения вопроса"""
        # Обновляем вопрос в списке
        for i, q in enumerate(self.test_task.questions):
            if q.id == question.id:
                self.test_task.questions[i] = question
                break
        
        self.refresh_questions()
        
        # Очищаем редактор вопроса и показываем placeholder
        if self.on_question_editor_closed:
            self.on_question_editor_closed()
        
        # Уведомление об изменении типа теста больше не нужно
        # Каждый вопрос может иметь разное количество правильных ответов
    
    def import_questions(self):
        """Импортирует вопросы из файла"""
        file_path = filedialog.askopenfilename(
            title="Выберите файл с вопросами",
            filetypes=[("Текстовые файлы", "*.txt"), ("Все файлы", "*.*")]
        )
        if file_path:
            # TODO: Реализовать импорт из файла
            messagebox.showinfo("Информация", "Импорт из файла будет реализован в следующем этапе")
    
    def save_test(self):
        """Сохраняет тест"""
        # Проверяем корректность теста
        errors = self.test_task.validate_test()
        if errors:
            messagebox.showerror("Ошибки в тесте", "\n".join(errors))
            return
        
        if self.on_save:
            self.on_save(self.test_task)
        
        messagebox.showinfo("Успех", "Тест сохранен")
    
    def get_frame(self):
        """Возвращает основной фрейм"""
        return self.frame

