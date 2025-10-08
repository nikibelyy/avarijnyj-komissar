<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json");

$bot_token = "8309884289:AAH4b64WzSEf8en2ZbFNl2DQ-iOSBlTYiJc";
$chat_id = "7523840597";

$data = json_decode(file_get_contents("php://input"), true);
$text = $data["text"] ?? "";

if (!$text) {
    echo json_encode(["error" => "Нет текста"]);
    exit;
}

$url = "https://api.telegram.org/bot{$bot_token}/sendMessage";
$params = [
    "chat_id" => $chat_id,
    "text" => $text,
    "parse_mode" => "HTML"
];

$options = [
    "http" => [
        "header"  => "Content-type: application/x-www-form-urlencoded\r\n",
        "method"  => "POST",
        "content" => http_build_query($params)
    ]
];

$context = stream_context_create($options);
$result = file_get_contents($url, false, $context);

echo $result;
?>
