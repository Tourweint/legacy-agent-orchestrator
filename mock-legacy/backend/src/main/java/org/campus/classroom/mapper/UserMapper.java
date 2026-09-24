package org.campus.classroom.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.ResultMap;
import org.apache.ibatis.annotations.Results;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import org.campus.classroom.entity.User;

import java.util.List;

public interface UserMapper {

    @Update("UPDATE user SET token_version = token_version + 1 WHERE id = #{userId}")
    int incrementTokenVersion(Long userId);

    @Select("select * from user where id = #{id}")
    @Results(id = "userResultMap", value = {
            @Result(column = "id", property = "id"),
            @Result(column = "username", property = "username"),
            @Result(column = "password", property = "password"),
            @Result(column = "nickname", property = "nickname"),
            @Result(column = "email", property = "email"),
            @Result(column = "role", property = "role"),
            @Result(column = "status", property = "status"),
            @Result(column = "credit_score", property = "creditScore"),
            @Result(column = "token_version", property = "tokenVersion"),
            @Result(column = "create_time", property = "createTime")
    })
    User selectById(Long id);

    @Select("select * from user where username = #{username} limit 1")
    @ResultMap("userResultMap")
    User selectByUsername(String username);

    @Select("select * from user where email = #{email} limit 1")
    @ResultMap("userResultMap")
    User selectByEmail(String email);

    @Insert("insert into user(username, password,nickname,email, role) values(#{username}, #{password}, #{nickname}, #{email},#{role})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(User user);

    @Select("""
            <script>
            SELECT *
            FROM user
            <where>
                <if test="keyword != null and keyword != ''">
                    AND (
                        username LIKE CONCAT('%', #{keyword}, '%')
                        OR nickname LIKE CONCAT('%', #{keyword}, '%')
                        OR email LIKE CONCAT('%', #{keyword}, '%')
                    )
                </if>
                <if test="role != null and role != ''">
                    AND role = #{role}
                </if>
                <if test="status != null">
                    AND status = #{status}
                </if>
            </where>
            ORDER BY create_time DESC, id DESC
            </script>
            """)
    @ResultMap("userResultMap")
    List<User> selectAdminList(@Param("keyword") String keyword,
                               @Param("role") String role,
                               @Param("status") Integer status);

    @Update("""
            UPDATE user
            SET status = #{status}
            WHERE id = #{id}
            """)
    int updateStatus(@Param("id") Long id, @Param("status") Integer status);

    @Update("""
            UPDATE user
            SET password = #{password}
            WHERE id = #{id}
            """)
    int updatePassword(@Param("id") Long id, @Param("password") String password);

    @Update("""
            UPDATE user
            SET nickname = #{nickname}
            WHERE id = #{id}
            """)
    int updateNickname(@Param("id") Long id, @Param("nickname") String nickname);

    @Update("""
            UPDATE user
            SET credit_score = GREATEST(#{minScore}, COALESCE(credit_score, #{maxScore}) - #{delta})
            WHERE id = #{id}
            """)
    int decreaseCreditScore(@Param("id") Long id,
                            @Param("delta") Integer delta,
                            @Param("minScore") Integer minScore,
                            @Param("maxScore") Integer maxScore);

    @Update("""
            UPDATE user
            SET credit_score = LEAST(#{maxScore}, GREATEST(#{minScore}, COALESCE(credit_score, #{maxScore}) + #{delta}))
            WHERE id = #{id}
            """)
    int increaseCreditScore(@Param("id") Long id,
                            @Param("delta") Integer delta,
                            @Param("minScore") Integer minScore,
                            @Param("maxScore") Integer maxScore);

    @Update("""
            UPDATE user
            SET credit_score = LEAST(#{maxScore}, GREATEST(#{minScore}, COALESCE(credit_score, #{maxScore}) + #{delta}))
            WHERE role = 'STUDENT'
              AND COALESCE(credit_score, #{maxScore}) < #{maxScore}
            """)
    int recoverCreditScoreDaily(@Param("delta") Integer delta,
                                @Param("minScore") Integer minScore,
                                @Param("maxScore") Integer maxScore);
}
