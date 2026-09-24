package org.campus.classroom.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class RefreshTokenDTO {
    @NotBlank(message = "refreshToken 不能为空")
    @JsonAlias({"refreshToken", "refresh_token"})
    private String refreshToken;
}
