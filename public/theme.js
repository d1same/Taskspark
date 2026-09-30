(function () {
  var theme = "light";
  try {
    if (localStorage.getItem("taskspark-theme") === "dark") theme = "dark";
  } catch (e) {}
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  var scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.content = theme;
  var color = document.querySelector('meta[name="theme-color"]');
  if (color) color.content = theme === "dark" ? "#1c1916" : "#fff8f2";
})();
